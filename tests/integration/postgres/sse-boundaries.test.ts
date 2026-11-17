import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request, errorCode } from './http-fixtures.js';
import { sseClient } from '../../support/sse/client.js';
import { owner, stores, seedRun, event } from './fixtures.js';
import { driver } from './durable-fixtures.js';
import { callsOf, finalText, StubMcp } from '../../unit/runtime/harness.js';
import { parseFrames } from '../../support/sse/frames.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';

test('stream quotas return safe 429 while existing subscription remains read-only', async () => {
  const db = await createDatabase(); const app = http(db.pool, { stream: { maxStreams: 1, maxStreamsPerScope: 1, pollMs: 20 } });
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId'); const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    client = await sseClient(`${origin}/api/v1/runs/${id}/events`); await client.next();
    const limited = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(limited.statusCode, 429); assert.equal(errorCode(limited.json()), 'RATE_LIMITED');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.model_calls')).rows[0].n, 0);
  } finally { await client?.close(); await app.close(); await db.drop(); }
});

test('periodic auth recheck closes a revoked live subscription without advancing execution', async () => {
  const db = await createDatabase(); let allowed = true;
  const app = http(db.pool, { authenticate: async () => allowed ? owner : undefined,
    stream: { pollMs: 10, authRefreshMs: 20, heartbeatMs: 20 } });
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId'); const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    client = await sseClient(`${origin}/api/v1/runs/${id}/events`); await client.next(); allowed = false;
    await assert.rejects(client.next());
    const row = (await db.pool.query('SELECT status, cancel_requested_at FROM viper_engine.runs WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'queued'); assert.equal(row.cancel_requested_at, null);
  } finally { await client?.close(); await app.close(); await db.drop(); }
});

test('oversized event fails before SSE headers with snapshot recovery, no silent output omission', async () => {
  const db = await createDatabase(); const app = http(db.pool, { eventBytes: 128 });
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 413, response.body); assert.equal(errorCode(response.json()), 'PAYLOAD_TOO_LARGE');
    assert.ok(!response.body.includes(': connected')); await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
  } finally { await app.close(); await db.drop(); }
});

test('legacy or incomplete stored event cannot leak internal payload; client can recover snapshot', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const run = await seedRun(db.pool, owner, 'sse-legacy');
    const s = stores(db.pool);
    assert.ok((await s.runs.transition(owner, run.runId, { to: 'waiting_for_input', expectedRevision: 2, at: Date.now(),
      events: [event('run.input_required', { payload: { secret: 'PRIVATE_RAW_METADATA' } })] })).ok);
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 410, response.body); assert.ok(!response.body.includes('PRIVATE_RAW_METADATA'));
    await request(app, 'GET', `/api/v1/runs/${run.runId}`, undefined, { status: 200, schema: 'RunSnapshot' });
  } finally { await app.close(); await db.drop(); }
});

test('unknown tool evidence stays OUTCOME_UNKNOWN in replay and cannot become a successful completion event', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    const mcp = new StubMcp(() => ({ status: 'unknown', content: [], error: { code: 'timeout', message: 'Remote timed out', retryable: false } }));
    const h = await driver(db.pool, [callsOf(['uncertain', 'lookup']), finalText('Done')], { mcp });
    await h.driver.runOnce('sse-unknown');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 200, response.body); const frames = parseFrames(response.body);
    assert.equal(frames.filter(frame => frame.event['type'] === 'run.completed').length, 0);
    const failed = frames.find(frame => frame.event['type'] === 'tool.failed'); assert.ok(failed);
    const payload = parseJsonObject(failed.event['payload']); assert.equal(payload['outcome'], 'unknown');
    assert.equal(parseJsonObject(payload['failure'])['code'], 'OUTCOME_UNKNOWN');
    assert.equal(frames.at(-1)?.event['type'], 'run.partial'); assert.equal(mcp.calls.length, 1);
  } finally { await app.close(); await db.drop(); }
});
