import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request } from './http-fixtures.js';
import { worker, until, runStatus } from './worker-fixtures.js';
import { anthropic, done } from './engine-fixtures.js';
import { EngineSetupError } from '../../../src/bootstrap/mcp-tools.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { persistedRunInstructions } from '../../../src/bootstrap/http.js';

test('two worker hosts run HTTP-queued jobs after HTTP closes, claiming each model attempt once', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  const a = anthropic(Array.from({ length: 6 }, () => done)); const b = anthropic(Array.from({ length: 6 }, () => done));
  const first = worker(db.pool, a.model, {}, { workerId: 'worker-a', concurrency: 2 });
  const second = worker(db.pool, b.model, {}, { workerId: 'worker-b', concurrency: 2 });
  try {
    const runs: string[] = [];
    for (let index = 0; index < 6; index += 1) runs.push(field(await start(app, await newConversation(app)), 'runId'));
    await app.close(); first.start(); second.start();
    await until(async () => (await db.pool.query("SELECT id FROM viper_engine.runs WHERE status <> 'completed'")).rows.length === 0);
    await Promise.all([first.stop(), second.stop()]);
    assert.equal(a.api.bodies.length + b.api.bodies.length, 6);
    assert.equal(first.status().settled + second.status().settled, 6);
    assert.ok(first.status().maxActive <= 2 && second.status().maxActive <= 2);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.model_calls')).rows[0].n, 6);
    assert.equal((await db.pool.query('SELECT id FROM viper_engine.runs WHERE lease_owner IS NOT NULL')).rows.length, 0);
    assert.equal((await db.pool.query('SELECT 1')).rowCount, 1);
  } finally { await first.stop(); await second.stop(); await app.close(); await db.drop(); }
});

test('poison setup defers durably, cannot starve healthy work and cancellation bypasses auth/discovery', async () => {
  const db = await createDatabase(); const app = http(db.pool); const { api, model } = anthropic([done]);
  const bad = field(await start(app, await newConversation(app)), 'runId');
  const good = field(await start(app, await newConversation(app)), 'runId');
  const configure = { connections: async (_scope: unknown, cp: { run: { id: string } }) => {
    if (cp.run.id === bad) throw new EngineSetupError('authentication_required'); return [];
  } };
  const first = worker(db.pool, model, configure); let next: ReturnType<typeof worker> | undefined;
  try {
    first.start(); await until(async () => await runStatus(db.pool, good) === 'completed');
    await until(async () => (await db.pool.query('SELECT failures FROM viper_engine.run_deliveries WHERE run_id = $1', [bad])).rows.length === 1);
    await first.stop(); assert.equal(api.bodies.length, 1);
    const row = (await db.pool.query('SELECT failures, failure_code FROM viper_engine.run_deliveries WHERE run_id = $1', [bad])).rows[0];
    assert.equal(Number(row.failures), 1); assert.equal(row.failure_code, 'authentication_required');
    const restarted = anthropic([done]); next = worker(db.pool, restarted.model, configure); next.start();
    await until(() => next!.status().idlePolls > 0); assert.equal(restarted.api.bodies.length, 0);
    await request(app, 'POST', `/api/v1/runs/${bad}/cancel`, {}, { status: 202 });
    await until(async () => await runStatus(db.pool, bad) === 'cancelled');
    assert.equal(restarted.api.bodies.length, 0);
    assert.equal(Number((await db.pool.query('SELECT failures FROM viper_engine.run_deliveries WHERE run_id = $1', [bad])).rows[0].failures), 1);
  } finally { await first.stop(); await next?.stop(); await app.close(); await db.drop(); }
});

test('worker loads private HTTP-prepared instructions automatically alongside static host instructions', async () => {
  const db = await createDatabase(); const { api, model } = anthropic([done]);
  const { seedEngineConnection } = await import('./engine-fixtures.js');
  const id = await seedEngineConnection(db.pool, 'http://127.0.0.1/unused', 'worker-context');
  const app = http(db.pool, { prepareContext: async () => [parseMessage({ id: 'saved-private', role: 'system',
    content: [{ type: 'text', text: 'SAVED_CONTEXT' }] })] });
  const saved = persistedRunInstructions(db.pool);
  const host = worker(db.pool, model, { instructions: async (scope, cp) => [parseMessage({ id: 'host-private', role: 'system',
    content: [{ type: 'text', text: 'HOST_CONTEXT' }] }), ...await saved(scope, cp)] });
  try {
    const conversation = await newConversation(app);
    const result = await request(app, 'POST', `/api/v1/conversations/${conversation}/runs`, { input: { content: [{ type: 'text', text: 'Question' }] },
      context: { resources: [{ connectionId: id, uri: 'fixture://policy' }] } }, { key: 'context', status: 202 });
    host.start(); await until(async () => await runStatus(db.pool, field(result, 'runId')) === 'completed');
    const system = JSON.stringify(api.bodies[0]?.['system']); assert.match(system, /SAVED_CONTEXT/); assert.match(system, /HOST_CONTEXT/);
    assert.equal(system.split('SAVED_CONTEXT').length - 1, 1);
    const history = await request(app, 'GET', `/api/v1/conversations/${conversation}`, undefined, { status: 200 });
    assert.ok(!JSON.stringify(history).includes('CONTEXT'));
  } finally { await host.stop(); await app.close(); await db.drop(); }
});

test('a run that keeps failing delivery is dead-lettered as failed after maxDeliveryFailures', async () => {
  const db = await createDatabase(); const app = http(db.pool); const { api, model } = anthropic([]);
  const bad = field(await start(app, await newConversation(app)), 'runId');
  const configure = { connections: async () => { throw new EngineSetupError('authentication_required'); } };
  const host = worker(db.pool, model, configure, { maxDeliveryFailures: 2, retry: { baseMs: 1, maxMs: 1, authenticationMs: 1 } });
  try {
    host.start();
    await until(async () => await runStatus(db.pool, bad) === 'failed', 'dead-letter');
    await host.stop();
    assert.equal(api.bodies.length, 0);
    assert.equal(Number((await db.pool.query('SELECT failures FROM viper_engine.run_deliveries WHERE run_id = $1', [bad])).rows[0].failures), 2);
    const events = (await db.pool.query('SELECT type, payload FROM viper_engine.run_events WHERE run_id = $1 ORDER BY sequence', [bad])).rows;
    assert.equal(events.at(-1)?.type, 'run.failed'); assert.equal(events.at(-1)?.payload.reason, 'delivery_failures');
  } finally { await host.stop(); await app.close(); await db.drop(); }
});
