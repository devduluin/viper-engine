import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, newConversation, start, field, request } from './http-fixtures.js';
import { seedEngine, anthropic, toolTurn, done } from './engine-fixtures.js';
import { worker, until, runStatus } from './worker-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { engineFixture } from '../../support/mcp/engine-fixture.js';
import { parseFrames } from '../../support/sse/frames.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import { sseClient } from '../../support/sse/client.js';
import { driver } from './durable-fixtures.js';
import { decided, callsOf, finalText, toolError, StubMcp } from '../../unit/runtime/harness.js';

test('actual SDK/MCP worker evidence replays without private instructions/meta or another provider/tool call', async () => {
  const db = await createDatabase(); const fixture = engineFixture(); const server = await startHttpServer({ fixture });
  const run = await seedEngine(db.pool, server.url, 'sse-real-mcp'); const app = http(db.pool);
  const { api, model } = anthropic([toolTurn('rich_result'), done]);
  const host = worker(db.pool, model, { connections: async () => [{ id: run.connectionId, namespace: 'inv' }],
    instructions: [parseMessage({ id: 'sse-private', role: 'system', content: [{ type: 'text', text: 'PRIVATE_SYSTEM_INSTRUCTION' }] })] });
  try {
    host.start(); await until(async () => await runStatus(db.pool, run.runId) === 'completed'); await host.stop();
    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/events`, headers: { authorization: 'Bearer owner' } });
      assert.equal(response.statusCode, 200, response.body); const frames = parseFrames(response.body);
      assert.equal(frames.at(-1)?.event['type'], 'run.completed');
      for (const value of ['Visible evidence', 'Embedded evidence', 'confirmed', 'aGVsbG8=']) assert.ok(response.body.includes(value), value);
      for (const value of ['PRIVATE_SYSTEM_INSTRUCTION', 'PRIVATE_MCP_META', 'endpoint_ref', 'secret_ref', 'decidedBy']) assert.ok(!response.body.includes(value), value);
    }
    assert.equal(api.bodies.length, 2); assert.deepEqual(fixture.calls, ['rich_result']);
  } finally { await host.stop(); await app.close(); await server.stop(); await db.drop(); }
});

test('input-required event is immediately actionable and preserves historical question/revision after resume', async () => {
  const db = await createDatabase(); const app = http(db.pool, { stream: { pollMs: 20 } });
  let client: Awaited<ReturnType<typeof sseClient>> | undefined;
  try {
    const id = field(await start(app, await newConversation(app)), 'runId'); const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    client = await sseClient(`${origin}/api/v1/runs/${id}/events`);
    const h = await driver(db.pool, [decided({ kind: 'needs_input', question: 'Which item?' })]); const pausing = h.driver.runOnce('sse-input');
    let payload: ReturnType<typeof parseJsonObject> | undefined;
    while (payload === undefined) {
      const frame = await client.next(); assert.ok(frame);
      if (frame.event['type'] === 'run.input_required') payload = parseJsonObject(frame.event['payload']);
    }
    assert.equal(payload['question'], 'Which item?');
    await request(app, 'POST', `/api/v1/runs/${id}/inputs`, { inputId: 'sse-answer', expectedRevision: payload['revision'],
      input: { content: [{ type: 'text', text: 'item-a' }] } }, { status: 202 });
    await pausing; await client.close();
    const next = await driver(db.pool, [finalText('Answered item-a')]); await next.driver.runOnce('sse-input-resume');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 200, response.body); const frames = parseFrames(response.body);
    const old = frames.find(frame => frame.event['type'] === 'run.input_required'); assert.deepEqual(old?.event['payload'], payload);
    assert.equal(h.model.requests.length, 1); assert.equal(next.model.requests.length, 1); assert.match(response.body, /Answered item-a/);
  } finally { await client?.close(); await app.close(); await db.drop(); }
});

test('failed and cancelled terminal events retain typed outcomes without claiming completion', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const failed = field(await start(app, await newConversation(app)), 'runId');
    const mcp = new StubMcp(() => toolError('not_found'));
    const first = await driver(db.pool, [callsOf(['sse-error', 'lookup']), finalText('Not found')], { mcp });
    await first.driver.runOnce('sse-failed');
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${failed}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(response.statusCode, 200, response.body); const frames = parseFrames(response.body);
    assert.equal(frames.at(-1)?.event['type'], 'run.failed'); assert.ok(frames.some(frame => frame.event['type'] === 'tool.failed'));
    assert.ok(!frames.some(frame => frame.event['type'] === 'run.completed'));
    const cancelled = field(await start(app, await newConversation(app)), 'runId');
    await request(app, 'POST', `/api/v1/runs/${cancelled}/cancel`, {}, { status: 202 });
    const second = await driver(db.pool, []); await second.driver.runOnce('sse-cancelled');
    const stopped = await app.inject({ method: 'GET', url: `/api/v1/runs/${cancelled}/events`, headers: { authorization: 'Bearer owner' } });
    assert.equal(stopped.statusCode, 200, stopped.body); assert.equal(parseFrames(stopped.body).at(-1)?.event['type'], 'run.cancelled');
    assert.equal(second.model.requests.length, 0); assert.equal(second.mcp.calls.length, 0);
  } finally { await app.close(); await db.drop(); }
});
