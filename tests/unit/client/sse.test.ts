import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SseParser } from '../../../src/adapters/http-client/sse-parser.js';
import { client, event, frame, sse, failure } from '../../support/client/fixtures.js';
import { withDeadline } from '../../../src/shared/async/deadline.js';

test('SSE parser handles split CRLF, comments, multiline data and does not inherit IDs', () => {
  const parser = new SseParser(1024);
  assert.deepEqual(parser.feed(': heartbeat\r'), []);
  assert.deepEqual(parser.feed('\n\r\nid: cursor_1\r\nevent: run.started\r\ndata: {\r'), []);
  assert.deepEqual(parser.feed('\ndata: "value": "é"}\r\n\r\n'), [{ id: 'cursor_1', type: 'run.started', data: '{\n"value": "é"}' }]);
  assert.deepEqual(parser.feed('data: next\n\n'), [{ data: 'next' }]);
});

test('SSE parser discards incomplete EOF and limits complete and pending frames', () => {
  const parser = new SseParser(100);
  assert.deepEqual(parser.feed('id: unacknowledged\ndata: incomplete\n'), []); assert.deepEqual(parser.finish(), []);
  assert.throws(() => new SseParser(5).feed('data: é\n\n'), failure('PAYLOAD_TOO_LARGE'));
  assert.throws(() => new SseParser(5).feed('ééé'), failure('PAYLOAD_TOO_LARGE'));
});

test('SSE reader validates durable envelope and ends without acknowledging an incomplete frame', async () => {
  const api = client(async () => sse(`${frame()}${frame(2).trimEnd()}`));
  const found = []; for await (const item of api.events('run-1')) found.push(item);
  assert.deepEqual(found, [{ event: event(), cursor: 'cursor_1' }]);
});

test('SSE reader decodes split Unicode bytes and cancels the body on consumer break', async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(frame().replace('"revision":1', '"revision":1,"future":"é"'));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  }, cancel() { cancelled = true; } });
  for await (const item of client(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })).events('run-1')) {
    assert.equal(item.event.sequence, 1); break;
  }
  assert.equal(cancelled, true);
});

test('SSE reader rejects wrong run, cursor, envelope type and unknown event', async () => {
  for (const body of [frame().replace('run-1', 'run-other'), frame().replace('id: cursor_1', 'id: bad cursor'),
    frame().replace('event: run.started', 'event: run.queued')]) {
    await assert.rejects(async () => { for await (const _ of client(async () => sse(body)).events('run-1')) { /* drain */ } }, failure('INVALID_RESPONSE'));
  }
  await assert.rejects(async () => { for await (const _ of client(async () => sse('event: future.event\ndata: {}\n\n')).events('run-1')) { /* drain */ } }, failure('UNSUPPORTED_EVENT'));
});

test('SSE reader bounds idle time, frame bytes and malformed UTF8', async () => {
  const hanging = new ReadableStream<Uint8Array>({ start() { /* no data */ } });
  const api = client(async () => new Response(hanging, { headers: { 'content-type': 'text/event-stream' } }), { streamIdleMs: 10 });
  await assert.rejects(async () => { for await (const _ of api.events('run-1')) { /* drain */ } }, failure('TIMEOUT'));
  await assert.rejects(async () => { for await (const _ of client(async () => sse(`data: ${'x'.repeat(5000)}\n\n`), { eventBytes: 10 }).events('run-1')) { /* drain */ } }, failure('PAYLOAD_TOO_LARGE'));
  const invalid = client(async () => new Response(Uint8Array.of(255), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(async () => { for await (const _ of invalid.events('run-1')) { /* drain */ } }, failure('INVALID_RESPONSE'));
});

test('ephemeral deltas never acknowledge a durable cursor or inherit the prior frame ID', async () => {
  const delta = { schemaVersion: 1, type: 'message.delta', conversationId: 'conversation-1', runId: 'run-1', stepId: 'step-1',
    modelCallId: 'model-1', messageId: 'message-1', occurredAt: 1, delta: 'provisional' };
  const found = [];
  const body = `${frame()}event: message.delta\ndata: ${JSON.stringify(delta)}\n\n${frame(2)}`;
  for await (const item of client(async () => sse(body)).events('run-1')) found.push(item.cursor);
  assert.deepEqual(found, ['cursor_1', 'cursor_2']);
  await assert.rejects(async () => {
    for await (const _ of client(async () => sse(`id: unsafe\nevent: message.delta\ndata: ${JSON.stringify(delta)}\n\n`)).events('run-1')) { /* drain */ }
  }, failure('INVALID_RESPONSE'));
});

test('aborting a pending stream closes its reader and never invokes the run cancel API', async () => {
  let cancelled = false; let calls = 0; const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ start() { /* waiting for event */ }, cancel() { cancelled = true; } });
  const api = client(async (_url, init) => { calls++; assert.equal(init?.method, 'GET'); return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); });
  const pending = (async () => { for await (const _ of api.events('run-1', { signal: controller.signal })) { /* drain */ } })();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, failure('CANCELLED')); assert.equal(cancelled, true); assert.equal(calls, 1);
});

test('idle timeout remains bounded when the fetch stream ignores its cancellation request', async () => {
  const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => undefined) });
  const api = client(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }), { streamIdleMs: 10 });
  await assert.rejects(withDeadline(async () => {
    for await (const _ of api.events('run-1')) { /* drain */ }
  }, { operationName: 'uncooperative reader cleanup', timeoutMs: 500 }), failure('TIMEOUT'));
});
