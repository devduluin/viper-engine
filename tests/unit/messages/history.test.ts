import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { assertMessageHistory, parseMessageHistory } from '../../../src/contracts/messages/history.js';

const call = (id: string) => ({ id, name: 'fixture.lookup', arguments: { id: 'item-1' } });
const assistant = (id: string, ids: string[]) => ({ id, role: 'assistant', content: [], toolCalls: ids.map(call) });
const result = (id: string, toolCallId: string, outcome = 'success') => ({
  id, role: 'tool', toolCallId, outcome, content: [{ type: 'json', data: { stock: 5 } }],
});

test('valid parallel calls accept out-of-order result completion without role alternation', () => {
  const history = parseMessageHistory([
    { id: 'm1', role: 'system', content: [{ type: 'text', text: 'System context' }] },
    { id: 'm2', role: 'system', content: [{ type: 'text', text: 'Additional context' }] },
    { id: 'm3', role: 'user', content: [{ type: 'text', text: 'Get stock' }] },
    assistant('m4', ['c1', 'c2']), result('m5', 'c2'), result('m6', 'c1'),
    { id: 'm7', role: 'assistant', content: [{ type: 'text', text: 'Both lookups complete' }] },
  ], { allowPendingToolCalls: false });
  assert.equal(history.length, 7);
  assert.equal(Object.isFrozen(history), true);
});

test('paused proposals can remain pending; complete model context requires matching results', () => {
  const messages = parseMessageHistory([assistant('m1', ['c1'])]);
  assert.doesNotThrow(() => assertMessageHistory(messages));
  assert.throws(() => assertMessageHistory(messages, { allowPendingToolCalls: false }), /still pending/);
});

test('unknown/error tool outcomes remain explicit and empty tool data is permitted', () => {
  for (const outcome of ['error', 'unknown']) {
    const history = parseMessageHistory([assistant('m1', ['c1']), { ...result('m2', 'c1', outcome), content: [] }]);
    const message = history[1];
    assert.equal(message?.role, 'tool');
    if (message?.role === 'tool') assert.equal(message.outcome, outcome);
  }
});

test('orphan, duplicate and future tool results are rejected', () => {
  for (const history of [
    [result('m1', 'unknown')],
    [assistant('m1', ['c1']), result('m2', 'c1'), result('m3', 'c1')],
    [result('m1', 'c1'), assistant('m2', ['c1'])],
  ]) assert.throws(() => parseMessageHistory(history), /no unmatched preceding call/);
});

test('message IDs and tool call IDs cannot be reused across a history', () => {
  assert.throws(() => parseMessageHistory([assistant('m1', ['c1', 'c1'])]), /Duplicate tool call/);
  assert.throws(() => parseMessageHistory([assistant('m1', ['c1']), result('m1', 'c1')]), /Duplicate message/);
  assert.throws(() => parseMessageHistory([assistant('m1', ['c1']), result('m2', 'c1'), assistant('m3', ['c1'])]), /Duplicate tool call/);
});

test('message boundary rejects unsupported roles, empty assistant replies, bad call args and scope fields', () => {
  const invalid: unknown[] = [
    { id: 'm1', role: 'invented', content: [] },
    { id: 'm1', role: 'assistant', content: [] },
    { id: 'm1', role: 'assistant', content: [], toolCalls: [] },
    { id: 'm1', role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'lookup', arguments: [] }] },
    { ...result('m1', 'c1'), outcome: 'invented' },
    { id: 'm1', role: 'user', content: [{ type: 'text', text: 'ok' }], actorId: 'untrusted' },
  ];
  for (const value of invalid) assert.throws(() => parseMessage(value));
  assert.throws(() => parseMessageHistory({}), /message history/);
});

test('message/content/history decoding does not execute accessors or custom iterators', () => {
  let invoked = false;
  const message = Object.defineProperty({ id: 'm1', content: [] }, 'role', {
    enumerable: true, get: () => { invoked = true; return 'user'; },
  });
  assert.throws(() => parseMessage(message), /accessors/);
  const content = [{ type: 'text', text: 'ok' }];
  Object.defineProperty(content, Symbol.iterator, { value: () => { invoked = true; return [].values(); } });
  assert.throws(() => parseMessage({ id: 'm1', role: 'user', content }), /symbol properties/);
  const history = [result('m1', 'c1')];
  Object.defineProperty(history, Symbol.iterator, { value: () => { invoked = true; return [].values(); } });
  assert.throws(() => parseMessageHistory(history), /symbol properties/);
  assert.equal(invoked, false);
});
