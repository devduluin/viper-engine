import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeltaBus, type EphemeralFrame } from '../../../src/application/streaming/delta-bus.js';
import { ClientToolBroker, type ClientToolRecord } from '../../../src/application/streaming/client-tools.js';
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

test('observer: one record per request with result, reason code, duration and size; never the data', async () => {
  let now = 1000;
  const broker = new ClientToolBroker(new DeltaBus(), () => now, 1000);
  const records: ClientToolRecord[] = [];
  const stop = broker.observe(record => records.push(record));
  broker.observe(() => { throw new Error('a broken logger never breaks the run'); });

  const ok = broker.request(call, 5000, new AbortController().signal);
  now = 1250;
  broker.reply('run-1', 'p1', { outcome: 'success', data: { title: 'Rahasia halaman' } });
  await ok;
  const denied = broker.request({ ...call, toolCallId: 'p2' }, 5000, new AbortController().signal);
  broker.reply('run-1', 'p2', { outcome: 'error', message: 'x' }, { code: 'not_allowed' });
  await denied;
  const outdated = broker.request({ ...call, toolCallId: 'p3' }, 5000, new AbortController().signal);
  broker.reply('run-1', 'p3', { outcome: 'error', message: 'x' }, { code: 'Loader Outdated!' }); // invalid code dropped
  await outdated;
  assert.deepEqual(records.map(({ result, code }) => ({ result, code })), [
    { result: 'success', code: undefined }, { result: 'error', code: 'not_allowed' }, { result: 'error', code: undefined }]);
  assert.deepEqual(Object.keys(records[0]!).sort(), ['bytes', 'durationMs', 'name', 'result', 'runId', 'toolCallId']);
  assert.equal(records[0]!.durationMs, 250);
  assert.ok(records[0]!.bytes! > 20);
  assert.ok(!JSON.stringify(records).includes('Rahasia'), 'no page content in logs');
  // a code on a success answer is ignored
  const tagged = broker.request({ ...call, toolCallId: 'p4' }, 5000, new AbortController().signal);
  broker.reply('run-1', 'p4', { outcome: 'success', data: {} }, { code: 'timeout' });
  await tagged;
  assert.equal(records.at(-1)!.code, undefined);
  stop();
  const silent = broker.request({ ...call, toolCallId: 'p5' }, 5000, new AbortController().signal);
  broker.reply('run-1', 'p5', { outcome: 'success', data: {} });
  await silent;
  assert.equal(records.length, 4, 'removed observer gets nothing');
});

test('observer: timeout, cancel, then late, duplicate and unmatched answers are told apart', async () => {
  const broker = new ClientToolBroker(new DeltaBus(), Date.now, 1000);
  const records: ClientToolRecord[] = [];
  broker.observe(record => records.push(record));
  await broker.request(call, 20, new AbortController().signal);
  const controller = new AbortController();
  const cancelled = broker.request({ ...call, toolCallId: 'p2' }, 5000, controller.signal);
  controller.abort(); await cancelled;
  const answered = broker.request({ ...call, toolCallId: 'p3' }, 5000, new AbortController().signal);
  broker.reply('run-1', 'p3', { outcome: 'success', data: {} }); await answered;

  assert.equal(broker.reply('run-1', 'p1', { outcome: 'error', message: 'x' }, { code: 'timeout' }), false);
  assert.equal(broker.reply('run-1', 'p2', { outcome: 'success', data: {} }), false);
  assert.equal(broker.reply('run-1', 'p3', { outcome: 'success', data: {} }), false);
  assert.equal(broker.reply('run-9', 'zz', { outcome: 'success', data: {} }), false);
  assert.deepEqual(records.map(({ result, name, code }) => [result, name, code]), [
    ['timeout', 'read_page', undefined], ['cancelled', 'read_page', undefined], ['success', 'read_page', undefined],
    ['late', 'read_page', 'timeout'], ['late', 'read_page', undefined], ['duplicate', 'read_page', undefined],
    ['unmatched', 'unknown', undefined]]);
  assert.ok(records[0]!.durationMs! >= 15);
  assert.equal(records.at(-1)!.durationMs, undefined);
});

test('recently finished requests are bounded (a long-lived process does not grow)', async () => {
  const broker = new ClientToolBroker(new DeltaBus(), Date.now, 1000);
  const records: ClientToolRecord[] = [];
  broker.observe(record => records.push(record));
  for (let index = 0; index < 600; index += 1) {
    const pending = broker.request({ ...call, toolCallId: `t${index}` }, 5000, new AbortController().signal);
    broker.reply('run-1', `t${index}`, { outcome: 'success', data: {} }); await pending;
  }
  broker.reply('run-1', 't0', { outcome: 'success', data: {} }); // evicted: no longer known
  broker.reply('run-1', 't599', { outcome: 'success', data: {} });
  assert.deepEqual(records.slice(-2).map(record => record.result), ['unmatched', 'duplicate']);
});
