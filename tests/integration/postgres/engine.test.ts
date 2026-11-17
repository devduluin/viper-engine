import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, stores } from './fixtures.js';
import { seedEngine, engine, anthropic, toolTurn, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';

test('composed engine discovers paginated MCP tools and completes a real SDK read chain', async () => {
  const db = await createDatabase(); const fixture = engineFixture();
  const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-chain');
  const { api, model } = anthropic([toolTurn('lookup_item', { id: 'item-1' }), toolTurn('add', { a: 5, b: 2 }, 'call-2'), done]);
  const app = engine(db.pool, run.connectionId, model);
  try {
    const result = await app.runOnce('engine-chain');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.deepEqual(fixture.calls, ['lookup_item', 'add']);
    assert.equal(api.bodies.length, 3);
    assert.match(JSON.stringify(api.bodies[1]?.['messages']), /"stock\\?":5/);
    assert.match(JSON.stringify(api.bodies[2]?.['messages']), /"sum\\?":7/);
    const cp = await checkpoint(db.pool, run.runId);
    assert.deepEqual(cp.history.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    assert.deepEqual(cp.toolCalls.map(call => [call.status, call.attempts]), [['succeeded', 1], ['succeeded', 1]]);
    assert.equal(cp.execution?.state['modelCalls'], 3);
    assert.deepEqual(await app.runOnce('no-duplicate'), { kind: 'idle' });
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('approved write survives new engine, consumes exact approval, and dispatches once', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-write');
  const first = engine(db.pool, run.connectionId, anthropic([toolTurn('record_write', { count: 5 })]).model);
  let next: ReturnType<typeof engine> | undefined;
  try {
    const paused = await first.runOnce('write-pause');
    assert.ok(paused.kind === 'settled' && paused.status === 'waiting_for_approval', JSON.stringify(paused));
    assert.equal(fixture.writes(), 0);
    const cp = await checkpoint(db.pool, run.runId); const approval = cp.approvals[0]; assert.ok(approval);
    assert.ok((await stores(db.pool).approvals.decide(owner, approval.id,
      { to: 'accepted', expectedRevision: approval.revision, at: Date.now(), events: [] })).ok);
    assert.equal(fixture.writes(), 0);
    await first.close();
    assert.ok((await stores(db.pool).runs.wake(owner, run.runId,
      { expectedRevision: cp.run.revision, at: Date.now(), events: [] })).ok);
    next = engine(db.pool, run.connectionId, anthropic([done]).model);
    const result = await next.runOnce('write-resume');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.equal(fixture.writes(), 1);
    assert.deepEqual(fixture.calls, ['record_write']);
    const after = await checkpoint(db.pool, run.runId);
    assert.equal(after.approvals[0]?.status, 'consumed');
    assert.deepEqual(after.approvals[0]?.arguments, { count: 5 });
    assert.deepEqual(await next.runOnce('write-again'), { kind: 'idle' });
  } finally { await first.close(); await next?.close(); await server.stop(); await db.drop(); }
});

test('invalid arguments reach model as correction and never reach the MCP server', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-schema');
  const { api, model } = anthropic([toolTurn('add', { a: '5', b: 2 }), toolTurn('add', { a: 5, b: 2 }, 'fixed-call'), done]);
  const app = engine(db.pool, run.connectionId, model);
  try {
    const result = await app.runOnce('schema');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.deepEqual(fixture.calls, ['add']);
    assert.match(JSON.stringify(api.bodies[1]?.['messages']), /invalid_value/);
    const cp = await checkpoint(db.pool, run.runId);
    assert.deepEqual(cp.toolCalls.map(call => call.status).sort(), ['rejected', 'succeeded']);
  } finally { await app.close(); await server.stop(); await db.drop(); }
});
