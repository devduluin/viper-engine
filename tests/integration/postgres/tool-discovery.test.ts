import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { setupRun, driver, clock } from './durable-fixtures.js';
import { callsOf, finalText } from '../../unit/runtime/harness.js';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';
import { owner, stores } from './fixtures.js';
import { PostgresCheckpointReader } from '../../../src/adapters/persistence/postgres/checkpoint-reader.js';
import type { DurableDriverDependencies } from '../../../src/application/durable/types.js';

test('discovery checkpoint survives restart/config changes and real approval still binds the underlying MCP call', async () => {
  const db = await createDatabase();
  try {
    const seeded = await setupRun(db.pool, 'discovery-resume');
    const tools = Array.from({ length: 400 }, (_, i) => ({ alias: i === 399 ? 'workin__lookup' : `margin__unrelated_${i}`,
      context: { scope: owner, connection: { id: seeded.tool.connectionId, serverId: seeded.tool.serverId } },
      definition: { ref: i === 399 ? seeded.tool : { ...seeded.tool, name: `unrelated_${i}` }, inputSchema: { type: 'object' } } }));
    const configure: DurableDriverDependencies['configure'] = async () => ({ model: 'scripted-test', maxModelCalls: 8, maxOutputTokens: 100,
      limits: { maxDurationMs: 30000 }, context: { windowTokens: 8000 }, tools, toolDiscovery: { mode: 'on', searchTopK: 1 } });
    const first = await driver(db.pool, [callsOf(['search-1', TOOL_SEARCH_NAME, { query: 'lookup', source: 'workin' }])], {
      configure, onEvent: event => { if (event.type === 'tools_discovered') throw new Error('simulated host death after discovery commit'); },
    });
    await assert.rejects(first.driver.runOnce('first'), /simulated host death/);
    const reader = new PostgresCheckpointReader(db.pool);
    const checkpoint = await reader.load(owner, seeded.runId); assert.ok(checkpoint.ok);
    assert.equal(checkpoint.value.toolCalls.length, 0);
    assert.equal(checkpoint.value.history.length, 1);
    assert.equal(checkpoint.value.execution?.state['modelCalls'], 1);
    const changedConfig: DurableDriverDependencies['configure'] = async (scope, cp) => ({ ...await configure(scope, cp), toolDiscovery: { mode: 'off' } });
    const second = await driver(db.pool, [callsOf(['write-1', 'workin__lookup', { id: 'a' }])], {
      configure: changedConfig, policy: { decide: () => 'requires_approval' },
    });
    const paused = await second.driver.runOnce('second'); assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval');
    assert.deepEqual(second.model.requests[0]?.tools.map(tool => tool.name), [TOOL_SEARCH_NAME, 'workin__lookup']);
    assert.ok(second.model.requests[0]?.messages.some(message => message.role === 'tool' && message.toolCallId === 'search-1'));
    assert.equal(second.mcp.calls.length, 0);
    const loaded = await reader.load(owner, seeded.runId); assert.ok(loaded.ok); const approval = loaded.value.approvals[0]; assert.ok(approval);
    assert.equal(approval.binding.tool.name, seeded.tool.name); assert.equal(approval.binding.toolCallId, 'write-1');
    const s = stores(db.pool);
    assert.ok((await s.approvals.decide(owner, approval.id, { to: 'accepted', expectedRevision: approval.revision, at: clock.now(), events: [] })).ok);
    assert.ok((await s.runs.wake(owner, seeded.runId, { expectedRevision: loaded.value.run.revision, at: clock.now(), events: [] })).ok);
    const third = await driver(db.pool, [finalText('Done')], { configure: changedConfig, policy: { decide: () => 'requires_approval' } });
    const result = await third.driver.runOnce('third'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(third.mcp.calls.length, 1);
    const final = await reader.load(owner, seeded.runId); assert.ok(final.ok);
    assert.equal(final.value.toolCalls.length, 1); assert.equal(final.value.approvals[0]?.status, 'consumed');
    assert.ok(!final.value.history.some(message => message.role === 'tool' && message.toolCallId === 'search-1'));
  } finally { await db.drop(); }
});

test('guessing a hidden alias does not create an executable ledger call', async () => {
  const db = await createDatabase();
  try {
    const seeded = await setupRun(db.pool, 'discovery-hidden');
    const host = await driver(db.pool, [callsOf(['hidden', 'lookup']), finalText('No execution')]);
    const original = host.deps.configure;
    const fresh = await driver(db.pool, [callsOf(['hidden', 'lookup']), finalText('No execution')], {
      configure: async (scope, cp) => ({ ...await original(scope, cp), toolDiscovery: { mode: 'on' } }),
    });
    await fresh.driver.runOnce('hidden'); assert.equal(fresh.mcp.calls.length, 0);
    const loaded = await new PostgresCheckpointReader(db.pool).load(owner, seeded.runId); assert.ok(loaded.ok);
    assert.equal(loaded.value.toolCalls.length, 0);
  } finally { await db.drop(); }
});
