import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request, errorCode } from './http-fixtures.js';
import { driver } from './durable-fixtures.js';
import { finalText } from '../../unit/runtime/harness.js';
import { parseFrames } from '../../support/sse/frames.js';
import { TestClock } from '../../support/agent/identity.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';

test('expired signed event cursor returns 410 with snapshot recovery, after ownership check', async () => {
  const db = await createDatabase(); const clock = new TestClock(Date.now());
  const app = http(db.pool, { clock, eventRetentionSeconds: 1 });
  try {
    const accepted = await start(app, await newConversation(app)); const id = field(accepted, 'runId');
    const cursor = field(await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 }), 'eventCursor');
    clock.advance(1001);
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`,
      headers: { authorization: 'Bearer owner', 'last-event-id': cursor } });
    assert.equal(response.statusCode, 410); assert.equal(errorCode(response.json()), 'EVENT_CURSOR_EXPIRED');
    assert.equal(parseJsonObject(parseJsonObject(response.json()['error'])['recovery'])['action'], 'fetch_snapshot');
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`,
      headers: { authorization: 'Bearer other', 'last-event-id': cursor } }); assert.equal(foreign.statusCode, 404);
  } finally { await app.close(); await db.drop(); }
});

test('pruned history returns 410 from beginning, snapshot cursor skips missing prefix without resetting allocation', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const accepted = await start(app, await newConversation(app)); const id = field(accepted, 'runId');
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
    await db.pool.query('DELETE FROM viper_engine.run_events WHERE run_id = $1', [id]);
    const h = await driver(db.pool, [finalText('After retained prefix')]); await h.driver.runOnce('sse-pruned');
    const absent = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(absent.statusCode, 410, absent.body);
    const replay = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`,
      headers: { authorization: 'Bearer owner', 'last-event-id': field(snapshot, 'eventCursor') } });
    assert.equal(replay.statusCode, 200, replay.body);
    const frames = parseFrames(replay.body); assert.equal(frames[0]?.event['sequence'], 2);
    assert.equal(frames.at(-1)?.event['type'], 'run.completed');
    const fresh = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
    const empty = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?cursor=${field(fresh, 'eventCursor')}`,
      headers: { authorization: 'Bearer owner' } }); assert.equal(empty.statusCode, 200); assert.equal(parseFrames(empty.body).length, 0);
  } finally { await app.close(); await db.drop(); }
});

test('retention lookback refuses stale event prefix even when client supplied no cursor', async () => {
  const db = await createDatabase(); const app = http(db.pool, { eventRetentionSeconds: 1 });
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    await db.pool.query('SELECT pg_sleep(1.1)');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 410, response.body);
  } finally { await app.close(); await db.drop(); }
});

test('mid-log gaps are never silently skipped', async () => {
  const db = await createDatabase(); const app = http(db.pool, { stream: { batchSize: 64 } });
  try {
    const id = field(await start(app, await newConversation(app)), 'runId');
    const h = await driver(db.pool, [finalText('Done')]); await h.driver.runOnce('sse-gap');
    await db.pool.query('DELETE FROM viper_engine.run_events WHERE run_id = $1 AND sequence = 2', [id]);
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 410, response.body);
  } finally { await app.close(); await db.drop(); }
});
