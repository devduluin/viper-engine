import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeltaBus, type EphemeralFrame } from '../../../src/application/streaming/delta-bus.js';
import { ClientToolBroker } from '../../../src/application/streaming/client-tools.js';
import type { ClientToolCall } from '../../../src/agent/runtime/types.js';

const call = { scope: {}, conversationId: 'conversation-1', runId: 'run-1', toolCallId: 'p1', name: 'read_page', arguments: { focus: 'table' } } as unknown as ClientToolCall;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('the request reaches the run stream, is re-sent until answered, and the reply resolves it once', async () => {
  const bus = new DeltaBus(); const frames: EphemeralFrame[] = [];
  bus.subscribe('run-1', frame => frames.push(frame));
  const broker = new ClientToolBroker(bus, () => 1000, 20);
  const pending = broker.request(call, 5000, new AbortController().signal);
  await wait(55);
  assert.ok(frames.length >= 2, 'resent while waiting');
  assert.deepEqual(frames[0], { schemaVersion: 1, type: 'client_tool.request', conversationId: 'conversation-1', runId: 'run-1',
    toolCallId: 'p1', name: 'read_page', arguments: { focus: 'table' }, expiresAt: 6000 });
  assert.equal(broker.reply('run-1', 'p1', { outcome: 'success', data: { title: 'Halaman' } }), true);
  assert.deepEqual(await pending, { outcome: 'success', data: { title: 'Halaman' } });
  assert.equal(broker.reply('run-1', 'p1', { outcome: 'success', data: {} }), false, 'second answer ignored');
  const count = frames.length; await wait(50);
  assert.equal(frames.length, count, 'no resend after the answer');
  assert.equal(broker.waiting, 0);
});

test('no answer: an error outcome at the deadline; cancellation also settles; other runs cannot answer', async () => {
  const broker = new ClientToolBroker(new DeltaBus(), Date.now, 1000);
  const timedOut = await broker.request(call, 30, new AbortController().signal);
  assert.equal(timedOut.outcome, 'error');
  const controller = new AbortController();
  const cancelled = broker.request(call, 5000, controller.signal);
  assert.equal(broker.reply('run-2', 'p1', { outcome: 'success', data: {} }), false);
  controller.abort();
  assert.equal((await cancelled).outcome, 'error');
  assert.equal(broker.waiting, 0);
});
