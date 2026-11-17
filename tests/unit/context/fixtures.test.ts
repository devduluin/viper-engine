import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleContext } from '../../../src/agent/context/assemble.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { MemoryHistoryFixtures } from '../../support/agent/history.js';
import { TestClock, TestIds } from '../../support/agent/identity.js';
import { ScriptedModel, SCRIPTED_CAPABILITIES } from '../../support/agent/scripted-model.js';
import { testContext, testScope } from '../../support/agent/setup.js';

test('memory history enforces scope, stale revision and append pairing without changing old snapshots', () => {
  const input = testContext();
  const store = new MemoryHistoryFixtures();
  const first = store.seed(input.scope, input.conversationId, input.history.messages);
  assert.throws(() => store.seed(input.scope, input.conversationId, []), /exists/);
  assert.throws(() => store.read(testScope('other'), input.conversationId), /Scope access denied/);
  assert.throws(() => store.append(input.scope, input.conversationId, 1, []), /Stale/);
  const result = parseMessage({ id: 'bad-result', role: 'tool', toolCallId: 'missing', outcome: 'success', content: [] });
  assert.throws(() => store.append(input.scope, input.conversationId, 0, [result]), /unmatched/);
  assert.equal(store.read(input.scope, input.conversationId).revision, 0);
  const next = parseMessage({ id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] });
  const second = store.append(input.scope, input.conversationId, 0, [next]);
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 2);
  assert.equal(second.revision, 1);
  assert.equal(Object.isFrozen(second.messages), true);
});

test('scripted model checks expected context and never silently repeats an exhausted script', async () => {
  const clock = new TestClock();
  const input = testContext();
  const { request } = assembleContext(input, SCRIPTED_CAPABILITIES, clock.now());
  const model = new ScriptedModel([{ expect: actual => assert.deepEqual(actual, request), result: {
    ok: true, decision: { kind: 'final', content: [{ type: 'text', text: 'Hello' }] },
    usage: { source: 'provider', inputTokens: 12, outputTokens: 2, totalTokens: 14 },
  } }], clock);
  const result = await model.generate(request);
  assert.equal(result.ok, true);
  assert.equal(model.requests.length, 1);
  assert.equal(model.remaining, 0);
  await assert.rejects(model.generate(request), /exhausted/);
  assert.equal(model.requests.length, 1);
});

test('abort, expired context and expectation mismatch consume no scripted response', async () => {
  const clock = new TestClock();
  const { request } = assembleContext({ ...testContext(), deadlineAt: clock.now() + 10 }, SCRIPTED_CAPABILITIES, clock.now());
  const model = new ScriptedModel([{ expect: () => { throw new Error('Wrong evidence'); }, result: {
    ok: false, error: { code: 'transport', message: 'Fixture transport failure', retryable: true },
    usage: { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null },
  } }], clock);
  await assert.rejects(model.generate(request, { signal: AbortSignal.abort(new Error('Stop')) }), /Stop/);
  await assert.rejects(model.generate(request), /Wrong evidence/);
  clock.advance(10);
  await assert.rejects(model.generate(request), /deadline/);
  assert.equal(model.remaining, 1);
  assert.equal(model.requests.length, 0);
});

test('test clock and IDs are repeatable and local to each fixture', () => {
  const clock = new TestClock(100);
  clock.advance(25);
  assert.equal(clock.now(), 125);
  assert.throws(() => clock.advance(-1), /Invalid/);
  const ids = new TestIds();
  assert.equal(ids.next('run'), 'test-run-1');
  assert.equal(ids.next('step'), 'test-step-2');
  assert.equal(new TestIds().next('run'), 'test-run-1');
});
