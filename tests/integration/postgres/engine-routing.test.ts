import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { seedEngine, seedEngineConnection, engine, anthropic, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';

test('identical remote tool names on two connections route by namespace and retain distinct bindings', async () => {
  const db = await createDatabase(); const left = engineFixture(); const right = engineFixture();
  const a = await startHttpServer({ fixture: left }); const b = await startHttpServer({ fixture: right });
  const run = await seedEngine(db.pool, a.url, 'route-left'); const second = await seedEngineConnection(db.pool, b.url, 'route-right');
  const { api, model } = anthropic([{ blocks: [
    { type: 'tool_use', id: 'left-call', name: 'left__lookup_item', input: { id: 'left-item' } },
    { type: 'tool_use', id: 'right-call', name: 'right__lookup_item', input: { id: 'right-item' } },
  ] }, done]);
  const app = engine(db.pool, run.connectionId, model, {
    connections: async () => [{ id: run.connectionId, namespace: 'left' }, { id: second, namespace: 'right' }],
  });
  try {
    const result = await app.runOnce('routing');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.deepEqual(left.calls, ['lookup_item']); assert.deepEqual(right.calls, ['lookup_item']);
    const cp = await checkpoint(db.pool, run.runId);
    assert.deepEqual(cp.toolCalls.map(call => call.tool.connectionId).sort(), [run.connectionId, second].sort());
    const names = (api.bodies[0]?.['tools'] as Record<string, unknown>[]).map(tool => tool['name']);
    assert.ok(names.includes('left__lookup_item')); assert.ok(names.includes('right__lookup_item'));
  } finally { await app.close(); await a.stop(); await b.stop(); await db.drop(); }
});
