import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { driver, setupRun, clock } from './durable-fixtures.js';
import { callsOf, finalText, decided, StubMcp } from '../../unit/runtime/harness.js';
import { owner, stores } from './fixtures.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';

test('durable loop persists exact call/outcome/history/audit/events and a terminal result', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-basic');
    const h = await driver(db.pool, [callsOf(['call-1', 'lookup', { id: 'a' }]), finalText('Done')]);
    const result = await h.driver.runOnce('worker-basic');
    assert.equal(result.kind, 'settled');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(h.mcp.calls.length, 1);
    const cp = await h.deps.checkpoints.load(owner, run.runId);
    assert.ok(cp.ok);
    assert.deepEqual(cp.value.history.map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);
    assert.deepEqual(cp.value.toolCalls.map(c => [c.status, c.attempts]), [['succeeded', 1]]);
    assert.equal(cp.value.execution?.state['modelCalls'], 2);
    const audit = await db.pool.query('SELECT outcome FROM viper_engine.model_calls WHERE run_id = $1', [run.runId]);
    assert.equal(audit.rowCount, 2);
    assert.ok(audit.rows.every(row => Reflect.get(Object(row), 'outcome') === 'succeeded'));
    assert.deepEqual(await h.driver.runOnce('worker-again'), { kind: 'idle' });
  } finally { await db.drop(); }
});

test('approval acceptance dispatches nothing; wake and a fresh lease execute the exact stored call once', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-approval');
    const h = await driver(db.pool, [callsOf(['approved-call', 'lookup', { count: 5 }])], { policy: { decide: () => 'requires_approval' } });
    const paused = await h.driver.runOnce('approval-first');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval');
    assert.equal(h.mcp.calls.length, 0);
    const cp = await h.deps.checkpoints.load(owner, run.runId);
    assert.ok(cp.ok);
    const approval = cp.value.approvals[0]; assert.ok(approval);
    assert.ok((await stores(db.pool).approvals.decide(owner, approval.id, { to: 'accepted', expectedRevision: 1, at: clock.now(), events: [] })).ok);
    assert.equal(h.mcp.calls.length, 0);
    assert.ok((await h.deps.runs.wake(owner, run.runId, { expectedRevision: cp.value.run.revision, at: clock.now(), events: [] })).ok);
    const resumed = await driver(db.pool, [finalText('Approved work done')], { policy: { decide: () => 'requires_approval' } });
    const result = await resumed.driver.runOnce('approval-resumed');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.deepEqual(resumed.mcp.calls.map(call => call.arguments), [{ count: 5 }]);
    const stored = await stores(db.pool).approvals.get(owner, approval.id);
    assert.ok(stored.ok && stored.value.status === 'consumed');
  } finally { await db.drop(); }
});

test('input pause survives a new driver and retains the model-call ceiling', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-input');
    const first = await driver(db.pool, [decided({ kind: 'needs_input', question: 'Which item?' })]);
    const paused = await first.driver.runOnce('input-first');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_input');
    const cp = await first.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    const { PostgresMessageStore } = await import('../../../src/adapters/persistence/postgres/message-store.js');
    assert.ok((await new PostgresMessageStore(db.pool).append(owner, run.conversationId, { expectedRevision: cp.value.conversationRevision,
      at: clock.now(), messages: [parseMessage({ id: 'input-answer', role: 'user', content: [{ type: 'text', text: 'item-a' }] })] })).ok);
    assert.ok((await first.deps.runs.wake(owner, run.runId, { expectedRevision: cp.value.run.revision, at: clock.now(), events: [] })).ok);
    const next = await driver(db.pool, [finalText('Got item-a')]);
    const result = await next.driver.runOnce('input-next');
    assert.ok(result.kind === 'settled' && result.status === 'completed');
    const after = await next.deps.checkpoints.load(owner, run.runId); assert.ok(after.ok);
    assert.equal(after.value.execution?.state['modelCalls'], 2);
  } finally { await db.drop(); }
});

test('cancelling a waiting run is claimable and cancels pending calls without dispatch', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-cancel-paused');
    const first = await driver(db.pool, [callsOf(['cancel-call', 'lookup'])], { policy: { decide: () => 'requires_approval' } });
    await first.driver.runOnce('pause-cancel');
    assert.ok((await first.deps.runs.requestCancellation(owner, run.runId, clock.now(), [])).ok);
    const next = await driver(db.pool, []);
    const result = await next.driver.runOnce('cancel-paused');
    assert.ok(result.kind === 'settled' && result.status === 'cancelled');
    assert.equal(next.mcp.calls.length, 0);
    const cp = await next.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.equal(cp.value.toolCalls[0]?.status, 'cancelled');
    assert.equal(cp.value.history.filter(message => message.role === 'tool').length, 1);
  } finally { await db.drop(); }
});

test('durable cancellation during an uncooperative MCP call retains unknown outcome and blocks later sends', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-cancel-live');
    const mcp = new StubMcp(async () => {
      await stores(db.pool).runs.requestCancellation(owner, run.runId, clock.now(), []);
      return new Promise(() => {});
    });
    const h = await driver(db.pool, [callsOf(['cancel-live-1', 'lookup'], ['cancel-live-2', 'lookup'])], { mcp, leaseMs: 1000, heartbeatMs: 100 });
    const result = await h.driver.runOnce('cancel-live');
    assert.ok(result.kind === 'settled' && result.status === 'cancelled');
    assert.equal(mcp.calls.length, 1);
    const cp = await h.deps.checkpoints.load(owner, run.runId); assert.ok(cp.ok);
    assert.deepEqual(cp.value.toolCalls.map(row => row.status).sort(), ['cancelled', 'unknown']);
  } finally { await db.drop(); }
});

test('approvalTtlMs sets the durable proposal lifetime; invalid values are refused when the driver is built', async () => {
  const db = await createDatabase();
  try {
    const run = await setupRun(db.pool, 'durable-approval-ttl');
    const ttl = 15 * 60_000;
    const h = await driver(db.pool, [callsOf(['ttl-call', 'lookup', { count: 1 }])], { policy: { decide: () => 'requires_approval' }, approvalTtlMs: ttl });
    const before = clock.now();
    const paused = await h.driver.runOnce('approval-ttl');
    const after = clock.now();
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval');
    const cp = await h.deps.checkpoints.load(owner, run.runId);
    assert.ok(cp.ok);
    const approval = cp.value.approvals[0]; assert.ok(approval);
    assert.ok(approval.expiresAt >= before + ttl && approval.expiresAt <= after + ttl);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      await assert.rejects(driver(db.pool, [], { approvalTtlMs: bad }), /Invalid approval TTL/);
    }
  } finally { await db.drop(); }
});
