import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import type { ModelGateway } from '../../../src/contracts/models/gateway.js';
import type { McpGateway } from '../../../src/contracts/mcp/gateway.js';
import { TestClock } from '../../support/agent/identity.js';
import { callsOf, finalText, harness, run, StubMcp, success } from './harness.js';

test('cancellation during awaited dispatch-intent persistence prevents every MCP invocation', async () => {
  const controller = new AbortController();
  const mcp = new StubMcp(() => assert.fail('dispatch must never start'));
  const h = harness([callsOf(['c1', 'save'], ['c2', 'lookup'])], mcp,
    { input: { signal: controller.signal }, deps: { onEvent: async event => {
      if (event.type === 'tool_call_dispatching') { await Promise.resolve(); controller.abort(); }
    } } });
  const result = await run(h);
  assert.equal(result.status, 'cancelled');
  assert.equal(mcp.calls.length, 0);
  assert.deepEqual(result.toolCalls.map(call => call.status), ['cancelled', 'cancelled']);
  assert.ok(result.toolCalls.every(call => call.dispatchState === 'not_sent'));
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('deadline is rechecked after intent and between sequential calls using the injected clock', async () => {
  const clock = new TestClock();
  const mcp = new StubMcp(() => assert.fail('expired intent cannot dispatch'));
  const h = harness([callsOf(['c1', 'save'])], mcp, { input: { limits: { maxDurationMs: 100 } }, deps: {
    clock, onEvent: event => { if (event.type === 'tool_call_dispatching') clock.advance(100); },
  } });
  assert.equal((await run(h)).reason, 'deadline_exceeded');
  assert.equal(mcp.calls.length, 0);
  const subsequent = new StubMcp(() => { clock.advance(100); return success({ ok: true }); });
  const next = harness([callsOf(['c1', 'lookup'], ['c2', 'save'])], subsequent,
    { input: { limits: { maxDurationMs: 100 } }, deps: { clock } });
  const result = await run(next);
  assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(subsequent.calls.length, 1);
  assert.equal(result.toolCalls[0]?.status, 'succeeded');
});

test('uncooperative model is bounded by real duration and its late rejection is absorbed', async () => {
  const h = harness([], new StubMcp(() => assert.fail('no dispatch')), { input: { limits: { maxDurationMs: 30 } } });
  let rejectLate: (reason: Error) => void = () => assert.fail('not started');
  let signal: AbortSignal | undefined;
  const model: ModelGateway = { capabilities: h.model.capabilities, generate: (_request, options) => {
    signal = options?.signal;
    return new Promise((_resolve, reject) => { rejectLate = reject; });
  } };
  const result = await run({ ...h, deps: { ...h.deps, model } });
  assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(signal?.aborted, true);
  rejectLate(new Error('late provider failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('tool timeout is unknown, never retried and remaining calls stay paired', async () => {
  const mcp = new StubMcp(() => new Promise(() => {}));
  const h = harness([callsOf(['c1', 'save'], ['c2', 'lookup'])], mcp,
    { input: { limits: { maxDurationMs: 30 } } });
  const result = await run(h);
  assert.deepEqual([result.status, result.reason], ['partial', 'deadline_exceeded']);
  assert.deepEqual(result.toolCalls.map(call => call.status), ['unknown', 'rejected']);
  assert.equal(mcp.calls.length, 1);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('cancellation returns from a gateway that ignores AbortSignal and preserves uncertainty', async () => {
  const controller = new AbortController();
  const h = harness([callsOf(['c1', 'save'], ['c2', 'lookup'])], new StubMcp(() => success({})),
    { input: { signal: controller.signal } });
  let calls = 0;
  const mcp: McpGateway = { ...h.deps.mcp,
    callTool: async () => { calls += 1; queueMicrotask(() => controller.abort()); return new Promise(() => {}); },
    getCapabilities: () => { throw new Error('not used'); }, listTools: () => { throw new Error('not used'); },
    listResources: () => { throw new Error('not used'); }, readResource: () => { throw new Error('not used'); },
    listPrompts: () => { throw new Error('not used'); }, getPrompt: () => { throw new Error('not used'); },
  };
  const result = await run({ ...h, deps: { ...h.deps, mcp } });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.toolCalls.map(call => call.status), ['unknown', 'cancelled']);
  assert.equal(calls, 1);
});

test('a final answer arriving after cancellation cannot complete the run', async () => {
  const controller = new AbortController();
  const h = harness([finalText('too late')], new StubMcp(() => success({})), { input: { signal: controller.signal }, deps: {
    onEvent: event => { if (event.type === 'model_call_finished') controller.abort(); },
  } });
  const result = await run(h);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.messages.length, 0);
});

test('normal completion and infrastructure errors remove cancellation listeners', async () => {
  const controller = new AbortController();
  const before = getEventListeners(controller.signal, 'abort').length;
  const h = harness([finalText('ok')], new StubMcp(() => success({})), { input: { signal: controller.signal } });
  await run(h);
  assert.equal(getEventListeners(controller.signal, 'abort').length, before);
  const failing = harness([finalText('never')], new StubMcp(() => success({})), { input: { signal: controller.signal }, deps: {
    onEvent: () => { throw new Error('persistence failed'); },
  } });
  await assert.rejects(run(failing), /persistence failed/);
  assert.equal(getEventListeners(controller.signal, 'abort').length, before);
});

test('cancellation while holding an approval batch settles undispatched proposals without execution', async () => {
  const controller = new AbortController();
  const mcp = new StubMcp(() => assert.fail('approval batch must not execute'));
  const h = harness([callsOf(['c1', 'save'], ['c2', 'lookup'])], mcp, {
    input: { signal: controller.signal }, deps: {
      policy: { decide: () => 'requires_approval' },
      onEvent: event => { if (event.type === 'tool_call_reported') controller.abort(); },
    },
  });
  const result = await run(h);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.toolCalls.map(call => call.status), ['cancelled', 'cancelled']);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  assert.equal(mcp.calls.length, 0);
});
