import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request, secret, errorCode } from './http-fixtures.js';
import { driver } from './durable-fixtures.js';
import { callsOf, finalText } from '../../unit/runtime/harness.js';
import { parseFrames } from '../../support/sse/frames.js';
import { SignedApiCursors } from '../../../src/adapters/http/cursors.js';
import { owner } from './fixtures.js';

test('SSE projects a full durable read chain with contiguous correlation and final evidence', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const accepted = await start(app, await newConversation(app)); const id = field(accepted, 'runId');
    const h = await driver(db.pool, [callsOf(['sse-call', 'lookup', { id: 'item' }]), finalText('Evidence complete')]);
    await h.driver.runOnce('sse-read');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 200, response.body); assert.match(String(response.headers['content-type']), /text\/event-stream/);
    assert.ok(response.headers['x-request-id']); const frames = parseFrames(response.body);
    assert.deepEqual(frames.map(frame => frame.event['sequence']), frames.map((_, i) => i + 1));
    assert.deepEqual(frames.map(frame => frame.event['type']), ['run.queued', 'run.started', 'step.started', 'message.completed',
      'tool.started', 'message.completed', 'tool.completed', 'step.started', 'message.completed', 'run.completed']);
    const started = frames.find(frame => frame.event['type'] === 'tool.started'); assert.equal(started?.event['toolCallId'], 'sse-call');
    assert.ok(started?.event['stepId']); assert.match(response.body, /Evidence complete/); assert.equal(h.mcp.calls.length, 1);
    const snapshot = await request(app, 'GET', `/api/v1/runs/${id}`, undefined, { status: 200 });
    assert.equal(snapshot['lastEventSequence'], frames.length);
    const tail = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`,
      headers: { authorization: 'Bearer owner', 'last-event-id': field(snapshot, 'eventCursor') } });
    assert.equal(tail.statusCode, 200); assert.equal(parseFrames(tail.body).length, 0);
  } finally { await app.close(); await db.drop(); }
});

test('reconnect after a received event replays only later durable sequences without another model/tool invocation', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const accepted = await start(app, await newConversation(app)); const id = field(accepted, 'runId');
    const h = await driver(db.pool, [finalText('Final retained')]); await h.driver.runOnce('sse-final');
    const first = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    const frames = parseFrames(first.body); const cursor = frames[1]?.cursor; assert.ok(cursor);
    const next = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?cursor=${cursor}`,
      headers: { authorization: 'Bearer owner', 'last-event-id': cursor } });
    assert.equal(next.statusCode, 200, next.body);
    assert.deepEqual(parseFrames(next.body).map(frame => frame.event['eventId']), frames.slice(2).map(frame => frame.event['eventId']));
    assert.equal(h.model.requests.length, 1); assert.equal(h.mcp.calls.length, 0);
    assert.match(next.body, /Final retained/); assert.ok(!next.body.includes('message.delta'));
  } finally { await app.close(); await db.drop(); }
});

test('cursor namespace, signature, future sequence, conflicting sources and foreign run fail before SSE opens', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const accepted = await start(app, await newConversation(app)); const id = field(accepted, 'runId');
    const cursor = new SignedApiCursors(secret, { now: () => Date.now() }, 86400000);
    const cases = [cursor.issue(owner, 'event', id, '9999'), cursor.issue(owner, 'messages', id, '0'),
      cursor.issue(owner, 'event', 'another-run', '0'), 'tampered'];
    for (const token of cases) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?cursor=${token}`, headers: { authorization: 'Bearer owner' } });
      assert.equal(response.statusCode, 400, response.body); assert.equal(errorCode(response.json()), 'INVALID_CURSOR');
    }
    const token = cursor.issue(owner, 'event', id, '0');
    const conflict = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?cursor=${token}`,
      headers: { authorization: 'Bearer owner', 'last-event-id': 'different' } }); assert.equal(conflict.statusCode, 400);
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?cursor=${token}`,
      headers: { authorization: 'Bearer other' } }); assert.equal(foreign.statusCode, 404);
  } finally { await app.close(); await db.drop(); }
});
