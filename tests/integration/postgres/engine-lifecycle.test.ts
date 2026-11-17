import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { createDatabase } from './database.js';
import { seedEngine, engine, anthropic, toolTurn, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';

test('engine composes stdio MCP transport and closes idempotently without owning database pool', async () => {
  const db = await createDatabase(); const run = await seedEngine(db.pool, 'fixture-command', 'engine-stdio');
  await db.pool.query("UPDATE viper_engine.mcp_servers SET transport = 'stdio' WHERE id = $1", ['server-engine-stdio']);
  const { api, model } = anthropic([toolTurn('lookup_item', { id: 'item-stdio' }), done]);
  const app = engine(db.pool, run.connectionId, model, { leaseMs: 30000, heartbeatMs: 3000,
    resolveEndpoint: server => {
      assert.equal(server.endpointRef, 'fixture-command');
      return { kind: 'stdio', command: process.execPath,
        args: ['--import', 'tsx', path.resolve('tests/support/mcp/stdio-entry.ts'), '--engine-fixture'] };
    },
  });
  try {
    const result = await app.runOnce('stdio');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.equal(api.bodies.length, 2);
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls[0]?.status, 'succeeded');
    await Promise.all([app.close(), app.close()]);
    assert.deepEqual(await app.runOnce('closed'), { kind: 'idle' });
    assert.equal((await db.pool.query('SELECT 1 AS alive')).rowCount, 1);
  } finally { await app.close(); await db.drop(); }
});

test('host shutdown yields active work; a fresh engine reconciles in-flight RPC without replay', async () => {
  const db = await createDatabase(); const fixture = engineFixture();
  let reached: (() => void) | undefined; const dispatched = new Promise<void>(resolve => { reached = resolve; });
  const server = await startHttpServer({ fixture: { ...fixture, onCall: name => { fixture.onCall?.(name); reached?.(); } } });
  const run = await seedEngine(db.pool, server.url, 'engine-close');
  const app = engine(db.pool, run.connectionId, anthropic([toolTurn('hang')]).model);
  let next: ReturnType<typeof engine> | undefined;
  try {
    const work = app.runOnce('close-first');
    await withDeadline(() => dispatched, { operationName: 'fixture dispatch', timeoutMs: 10000 });
    await app.close();
    const result = await work;
    assert.equal(result.kind, 'yielded');
    assert.deepEqual(await app.runOnce('closed'), { kind: 'idle' });
    const { api, model } = anthropic([done]); next = engine(db.pool, run.connectionId, model);
    const resumed = await next.runOnce('close-resume');
    assert.ok(resumed.kind === 'settled' && resumed.status === 'partial', JSON.stringify(resumed));
    assert.deepEqual(fixture.calls, ['hang']);
    assert.equal(api.bodies.length, 0);
    assert.equal((await checkpoint(db.pool, run.runId)).toolCalls[0]?.status, 'unknown');
  } finally { await app.close(); await next?.close(); await server.stop(); await db.drop(); }
});
