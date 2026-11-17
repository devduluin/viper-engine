import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { callsOf, finalText, harness, run, StubMcp, success, toolError } from './harness.js';

function fullHistory(h: ReturnType<typeof harness>, appended: readonly Message[]): readonly Message[] {
  return [...h.input.history.messages, ...appended];
}

test('final-only answer completes without any MCP dispatch', async () => {
  const mcp = new StubMcp(() => assert.fail('no dispatch expected'));
  const h = harness([finalText('Hello')], mcp);
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'final_answer');
  assert.equal(result.modelCalls, 1);
  assert.equal(mcp.calls.length, 0);
  assert.deepEqual(result.messages.map(message => message.role), ['assistant']);
  assert.equal(Object.isFrozen(result), true);
});

test('tool result is fed back to the next model call and pairing is preserved', async () => {
  const mcp = new StubMcp(request => success({ id: String(request.arguments['id']), stock: 5 }));
  const h = harness([callsOf(['c1', 'lookup', { id: 'item-1' }]), finalText('Stock: 5')], mcp);
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.equal(mcp.calls.length, 1);
  assert.equal(mcp.calls[0]?.toolCallId, 'c1');
  assert.equal(mcp.calls[0]?.tool.name, 'lookup');
  const evidence = h.model.requests[1]?.messages.at(-1);
  assert.equal(evidence?.role, 'tool');
  assert.ok(evidence?.role === 'tool' && evidence.toolCallId === 'c1' && evidence.outcome === 'success');
  assert.deepEqual(evidence.content.at(-1), { type: 'json', data: { id: 'item-1', stock: 5 } });
  assertMessageHistory(fullHistory(h, result.messages), { allowPendingToolCalls: false });
});

test('multi-step chain runs one model call per step in order', async () => {
  const mcp = new StubMcp(request => success({ name: request.tool.name }));
  const h = harness([
    callsOf(['c1', 'lookup', { id: 'item-1' }]), callsOf(['c2', 'save', { text: 'x' }]), finalText('Done'),
  ], mcp);
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c1', 'c2']);
  assert.deepEqual(result.messages.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool', 'assistant']);
  assert.equal(h.model.requests.length, 3);
  assert.equal(h.model.remaining, 0);
});

test('a fluent final answer after only failed calls is a failed run; mixed evidence is partial', async () => {
  const failing = harness([callsOf(['c1', 'lookup', { id: 'missing' }]), finalText('Item was not found')],
    new StubMcp(() => toolError()));
  const failed = await run(failing);
  assert.deepEqual([failed.status, failed.reason], ['failed', 'tool_failures']);
  assert.equal(failed.toolCalls[0]?.failureCode, 'not_found');
  const mixed = harness([callsOf(['c1', 'lookup', { id: 'a' }], ['c2', 'lookup', { id: 'missing' }]), finalText('Half')],
    new StubMcp(request => request.arguments['id'] === 'a' ? success({ ok: true }) : toolError()));
  const partial = await run(mixed);
  assert.deepEqual([partial.status, partial.reason], ['partial', 'tool_failures']);
  assert.deepEqual(partial.toolCalls.map(call => call.status), ['succeeded', 'failed']);
});

test('needs_input pauses without dispatch and records the question', async () => {
  const h = harness([{ ok: true, decision: { kind: 'needs_input', question: 'Which item ID?' }, usage: { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } }],
    new StubMcp(() => assert.fail('no dispatch expected')));
  const result = await run(h);
  assert.deepEqual([result.status, result.reason, result.question], ['waiting_for_input', 'needs_input', 'Which item ID?']);
  assert.deepEqual(result.messages[0]?.content, [{ type: 'text', text: 'Which item ID?' }]);
});

test('model failure and reused tool call IDs stop as failed without dispatching', async () => {
  const failure = { code: 'rate_limited', message: 'slow down', retryable: true } as const;
  const failed = await run(harness([{ ok: false, error: failure, usage: { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } }],
    new StubMcp(() => assert.fail('no dispatch'))));
  assert.deepEqual([failed.status, failed.reason], ['failed', 'model_failure']);
  assert.deepEqual(failed.modelFailure, failure);
  const mcp = new StubMcp(() => success({ ok: true }));
  const reused = await run(harness([callsOf(['c1', 'lookup']), callsOf(['c1', 'lookup'])], mcp));
  assert.deepEqual([reused.status, reused.reason], ['failed', 'invalid_model_response']);
  assert.equal(mcp.calls.length, 1);
});

test('model call ceiling stops a runaway loop before an extra model call', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const h = harness([callsOf(['c1', 'lookup']), callsOf(['c2', 'lookup']), finalText('never')], mcp, { input: { maxModelCalls: 2 } });
  const result = await run(h);
  assert.deepEqual([result.status, result.reason, result.modelCalls], ['failed', 'model_call_limit', 2]);
  assert.equal(h.model.remaining, 1);
  for (const value of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(run(harness([], mcp, { input: { maxModelCalls: value } })), RangeError);
  }
});

test('an expired deadline stops before calling the model', async () => {
  const h = harness([finalText('late')], new StubMcp(() => assert.fail('no dispatch')));
  const result = await run({ ...h, input: { ...h.input, deadlineAt: h.deps.clock.now() } });
  assert.deepEqual([result.status, result.reason, result.modelCalls], ['failed', 'deadline_exceeded', 0]);
  assert.equal(h.model.requests.length, 0);
});

test('events are ordered: model start/finish, assistant append, dispatch intent, report, result, stop', async () => {
  const h = harness([callsOf(['c1', 'lookup']), finalText('ok')], new StubMcp(() => success({ ok: true })));
  await run(h);
  assert.deepEqual(h.events.map(event => event.type), [
    'model_call_started', 'model_call_finished', 'message_appended', 'tool_call_dispatching',
    'tool_call_reported', 'message_appended', 'batch_finished', 'model_call_started', 'model_call_finished',
    'message_appended', 'run_stopped',
  ]);
  assert.ok(h.events.every(event => Object.isFrozen(event)));
});

test('identical scripts produce identical results and events (deterministic IDs and order)', async () => {
  const frames = () => [callsOf(['c1', 'lookup', { id: 'item-1' }]), finalText('Stock: 5')];
  const first = harness(frames(), new StubMcp(() => success({ stock: 5 })));
  const second = harness(frames(), new StubMcp(() => success({ stock: 5 })));
  assert.deepEqual(await run(first), await run(second));
  assert.deepEqual(first.events, second.events);
});
