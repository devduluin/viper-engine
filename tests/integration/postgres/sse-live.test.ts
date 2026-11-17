import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request } from './http-fixtures.js';
import { driver } from './durable-fixtures.js';
import { callsOf, finalText } from '../../unit/runtime/harness.js';
import { sseClient } from '../../support/sse/client.js';
import { parseFrames } from '../../support/sse/frames.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';

test('live SSE observes committed approval pause, immediate accept succeeds and replay preserves original pending view', async () => {
  const db = await createDatabase(); const app = http(db.pool, { stream: { pollMs: 20, heartbeatMs: 50 } });
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    const origin = await app.listen({ host: '127.0.0.1', port: 0 }); client = await sseClient(`${origin}/api/v1/runs/${id}/events`);
    const h = await driver(db.pool, [callsOf(['sse-approved', 'lookup', { count: 5 }])], { policy: { decide: () => 'requires_approval' } });
    const pausing = h.driver.runOnce('sse-approval');
    let approval: ReturnType<typeof parseJsonObject> | undefined;
    while (approval === undefined) {
      const frame = await client.next(); assert.ok(frame);
      if (frame.event['type'] === 'approval.required') approval = parseJsonObject(parseJsonObject(frame.event['payload'])['approval']);
    }
    await request(app, 'POST', `/api/v1/approvals/${field(approval, 'approvalId')}/decision`,
      { expectedRevision: approval['revision'], proposal: approval['proposal'], decision: 'accept' }, { status: 200 });
    await pausing; await client.close();
    const next = await driver(db.pool, [finalText('Approved effect done')], { policy: { decide: () => 'requires_approval' } });
    await next.driver.runOnce('sse-approved-next'); assert.equal(next.mcp.calls.length, 1);
    const replay = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(replay.statusCode, 200, replay.body);
    const required = parseFrames(replay.body).filter(frame => frame.event['type'] === 'approval.required'); assert.equal(required.length, 1);
    const old = parseJsonObject(parseJsonObject(required[0]!.event['payload'])['approval']);
    assert.equal(old['status'], 'pending'); assert.equal(old['revision'], 1);
  } finally { await client?.close(); await app.close(); await db.drop(); }
});

test('heartbeat has no durable cursor and disconnect cannot cancel work or start a model call', async () => {
  const db = await createDatabase(); const app = http(db.pool, { stream: { pollMs: 20, heartbeatMs: 30 } });
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    const origin = await app.listen({ host: '127.0.0.1', port: 0 }); client = await sseClient(`${origin}/api/v1/runs/${id}/events`);
    const first = await client.next(); assert.equal(first?.event['type'], 'run.queued');
    const heartbeat = await client.nextRaw(); assert.ok(heartbeat?.startsWith(': heartbeat'));
    await client.close();
    const row = (await db.pool.query('SELECT status, cancel_requested_at, last_event_sequence FROM viper_engine.runs WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'queued'); assert.equal(row.cancel_requested_at, null); assert.equal(Number(row.last_event_sequence), 1);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.model_calls')).rows[0].n, 0);
    const h = await driver(db.pool, [finalText('After SSE closed')]); await h.driver.runOnce('after-stream-close');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 }); assert.equal(snapshot['status'], 'completed');
  } finally { await client?.close(); await app.close(); await db.drop(); }
});

test('HTTP close terminates active SSE promptly and leaves run and database untouched', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId'); const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    client = await sseClient(`${origin}/api/v1/runs/${id}/events`); await client.next(); await app.close();
    const row = (await db.pool.query('SELECT status, cancel_requested_at FROM viper_engine.runs WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'queued'); assert.equal(row.cancel_requested_at, null); assert.equal((await db.pool.query('SELECT 1')).rowCount, 1);
  } finally { await client?.close(); await app.close(); await db.drop(); }
});
