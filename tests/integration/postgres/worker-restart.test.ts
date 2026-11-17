import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { seedEngine, anthropic, toolTurn, done, checkpoint } from './engine-fixtures.js';
import { worker, until, runStatus } from './worker-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';
import { crashWorker } from '../../support/durable/process.js';
import { setupRun } from './durable-fixtures.js';

test('worker restart after a real MCP effect preserves unknown and never repeats the remote invocation', async () => {
  const db = await createDatabase(); let effects = 0; const fixture = engineFixture();
  const server = await startHttpServer({ fixture: { ...fixture,
    extraTools: [...(fixture.extraTools ?? []), { name: 'apply_then_hang', inputSchema: { type: 'object' } }],
    handlers: { ...fixture.handlers, apply_then_hang: async () => { effects += 1; return new Promise(() => undefined); } },
  } });
  const run = await seedEngine(db.pool, server.url, 'worker-effect');
  const options = { connections: async () => [{ id: run.connectionId, namespace: 'inv' }] };
  const first = worker(db.pool, anthropic([toolTurn('apply_then_hang'), done]).model, options);
  let next: ReturnType<typeof worker> | undefined;
  try {
    first.start(); await until(() => effects === 1, 'real MCP effect'); await first.stop();
    assert.equal(await runStatus(db.pool, run.runId), 'running');
    const restarted = anthropic([done]); next = worker(db.pool, restarted.model, options); next.start();
    await until(async () => await runStatus(db.pool, run.runId) === 'partial'); await next.stop();
    assert.equal(effects, 1); assert.equal(restarted.api.bodies.length, 0);
    assert.deepEqual(fixture.calls, ['apply_then_hang']);
    const cp = await checkpoint(db.pool, run.runId);
    assert.deepEqual(cp.toolCalls.map(call => [call.status, call.attempts]), [['unknown', 1]]);
    assert.equal(cp.history.filter(message => message.role === 'tool' && message.outcome === 'unknown').length, 1);
  } finally { await first.stop(); await next?.stop(); await server.stop(); await db.drop(); }
});

test('OS-killed polling host recovers its expired claim without repeating a committed effect', async () => {
  const db = await createDatabase();
  let next: ReturnType<typeof worker> | undefined;
  try {
    await db.pool.query('CREATE TABLE public.fixture_effects(call_id text NOT NULL)');
    const run = await setupRun(db.pool, 'worker-os-restart');
    await crashWorker(db.name, 'host', 'host-effect', 'tests/support/worker/crash-host.ts');
    await db.pool.query('SELECT pg_sleep(1.1)');
    const restarted = anthropic([done]); next = worker(db.pool, restarted.model); next.start();
    await until(async () => await runStatus(db.pool, run.runId) === 'partial'); await next.stop();
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM public.fixture_effects')).rows[0].n, 1);
    assert.equal(restarted.api.bodies.length, 0);
    const cp = await checkpoint(db.pool, run.runId); assert.equal(cp.toolCalls[0]?.status, 'unknown');
  } finally { await next?.stop(); await db.drop(); }
});
