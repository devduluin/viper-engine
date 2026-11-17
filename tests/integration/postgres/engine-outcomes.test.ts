import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner } from './fixtures.js';
import { seedEngine, engine, anthropic, toolTurn, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';
import { EngineSetupError } from '../../../src/bootstrap/mcp-tools.js';
import { PostgresMcpConnectionStore } from '../../../src/adapters/persistence/postgres/mcp-connection-store.js';

test('MCP isError evidence prevents a fluent model answer from claiming completion', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-error');
  const { api, model } = anthropic([toolTurn('lookup_item', { id: 'missing' }), done]);
  const app = engine(db.pool, run.connectionId, model);
  try {
    const result = await app.runOnce('error');
    assert.ok(result.kind === 'settled' && result.status === 'failed', JSON.stringify(result));
    assert.deepEqual(fixture.calls, ['lookup_item']);
    assert.match(JSON.stringify(api.bodies[1]?.['messages']), /is_error/);
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls[0]?.status, 'failed');
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('real MCP timeout retains unknown evidence and does not retry an uncertain tool', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-unknown');
  const { api, model } = anthropic([toolTurn('hang'), done]);
  const app = engine(db.pool, run.connectionId, model, { requestTimeoutMs: 1500 });
  try {
    const result = await app.runOnce('unknown');
    assert.ok(result.kind === 'settled' && result.status === 'partial', JSON.stringify(result));
    assert.deepEqual(fixture.calls, ['hang']);
    const cp = await checkpoint(db.pool, run.runId);
    assert.equal(cp.toolCalls[0]?.status, 'unknown');
    assert.match(JSON.stringify(api.bodies[1]?.['messages']), /unknown/);
    assert.deepEqual(await app.runOnce('no-unknown-retry'), { kind: 'idle' });
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('discovery auth failure fails closed before model/dispatch and marks connection for reauthorization', async () => {
  const db = await createDatabase(); const server = await startHttpServer({ token: () => 'required' });
  const run = await seedEngine(db.pool, server.url, 'engine-auth'); const { api, model } = anthropic([done]);
  const app = engine(db.pool, run.connectionId, model, { credentials: {
    resolve: async () => ({ ok: true, credential: { kind: 'bearer', token: 'wrong' } }),
    refresh: async () => ({ ok: false, code: 'authentication_required' }),
  } });
  try {
    await assert.rejects(app.runOnce('auth'), error => error instanceof EngineSetupError && error.code === 'authentication_required');
    assert.equal(api.bodies.length, 0);
    const access = await new PostgresMcpConnectionStore(db.pool).get(owner, run.connectionId);
    assert.ok(access.ok && access.value.authState === 'authentication_required');
    const cp = await checkpoint(db.pool, run.runId);
    assert.equal(cp.toolCalls.length, 0);
    assert.equal(cp.run.status, 'running');
  } finally { await app.close(); await server.stop(); await db.drop(); }
});

test('revocation after model proposal blocks cached-session dispatch', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'engine-revoke');
  const app = engine(db.pool, run.connectionId, anthropic([toolTurn('add', { a: 1, b: 2 }), done]).model, {
    onEvent: async event => {
      if (event.type === 'model_call_finished') await new PostgresMcpConnectionStore(db.pool).revoke(owner, run.connectionId, Date.now());
    },
  });
  try {
    const result = await app.runOnce('revoke');
    assert.ok(result.kind === 'settled' && result.status === 'failed', JSON.stringify(result));
    assert.deepEqual(fixture.calls, []);
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls[0]?.status, 'failed');
  } finally { await app.close(); await server.stop(); await db.drop(); }
});
