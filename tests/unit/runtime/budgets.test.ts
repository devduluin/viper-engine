import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import { resolveRunLimits } from '../../../src/agent/policies/limits.js';
import { callsOf, finalText, harness, run, StubMcp, success } from './harness.js';

test('step limit stops before another model call while preserving completed tool results', async () => {
  const mcp = new StubMcp(() => success({ stock: 5 }));
  const h = harness([callsOf(['c1', 'lookup']), finalText('never')], mcp, { input: { limits: { maxSteps: 1 } } });
  const result = await run(h);
  assert.deepEqual([result.status, result.reason, result.modelCalls], ['failed', 'step_limit', 1]);
  assert.deepEqual(result.budget.steps, 1);
  assert.equal(h.model.remaining, 1);
  assert.equal(result.toolCalls[0]?.status, 'succeeded');
});

test('tool proposal limit refuses a whole oversized batch before append or dispatch', async () => {
  const mcp = new StubMcp(() => assert.fail('budget must block'));
  const h = harness([callsOf(['c1', 'lookup'], ['c2', 'save'])], mcp, { input: { limits: { maxToolCalls: 1 } } });
  const result = await run(h);
  assert.equal(result.reason, 'tool_call_limit');
  assert.equal(result.messages.length, 0);
  assert.equal(result.budget.toolCalls, 0);
  assert.equal(mcp.calls.length, 0);
});

test('canonical repetition guard ignores new IDs and object key order', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const h = harness([callsOf(['c1', 'lookup', { a: 1, b: 2 }]), callsOf(['c2', 'lookup', { b: 2, a: 1 }])], mcp,
    { input: { limits: { maxRepeatedToolCalls: 1 } } });
  const result = await run(h);
  assert.deepEqual([result.status, result.reason], ['failed', 'repetition_limit']);
  assert.equal(mcp.calls.length, 1);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('different arguments remain distinct and rejected proposals also consume bounded capacity', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const distinct = harness([callsOf(['c1', 'lookup', { id: 'a' }]), callsOf(['c2', 'lookup', { id: 'b' }]), finalText('done')], mcp,
    { input: { limits: { maxRepeatedToolCalls: 1 } } });
  assert.equal((await run(distinct)).status, 'completed');
  assert.equal(mcp.calls.length, 2);
  const denied = harness([callsOf(['c1', 'missing']), callsOf(['c2', 'missing'])], mcp,
    { input: { limits: { maxToolCalls: 1 } } });
  const result = await run(denied);
  assert.equal(result.reason, 'tool_call_limit');
  assert.equal(result.toolCalls[0]?.status, 'rejected');
});

test('model output is measured as UTF-8 bytes and refused before a proposal can execute', async () => {
  const frame = callsOf(['c1', 'lookup', { text: '😀'.repeat(100) }]);
  const mcp = new StubMcp(() => assert.fail('no dispatch'));
  const result = await run(harness([frame], mcp, { input: { limits: { maxModelOutputBytes: 400 } } }));
  assert.equal(result.reason, 'model_output_limit');
  assert.equal(result.messages.length, 0);
  assert.equal(mcp.calls.length, 0);
  assert.ok(result.budget.modelOutputBytes > 400);
});

test('oversized successful tool output stops the batch but preserves known execution outcome', async () => {
  const mcp = new StubMcp(() => success({ data: 'x'.repeat(1000) }));
  const h = harness([callsOf(['c1', 'lookup'], ['c2', 'save'])], mcp,
    { input: { limits: { maxToolOutputBytes: 100 } } });
  const result = await run(h);
  assert.equal(result.reason, 'tool_output_limit');
  assert.deepEqual(result.toolCalls.map(call => call.status), ['succeeded', 'rejected']);
  assert.equal(mcp.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result.messages), /xxxx/);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('cumulative output limit is independent from each single-response limit', async () => {
  const mcp = new StubMcp(() => success({ text: 'x'.repeat(80) }));
  const h = harness([callsOf(['c1', 'lookup']), finalText('never')], mcp,
    { input: { limits: { maxTotalOutputBytes: 250 } } });
  const result = await run(h);
  assert.equal(result.reason, 'total_output_limit');
  assert.equal(h.model.requests.length, 1);
  assert.equal(result.toolCalls[0]?.status, 'succeeded');
});

test('tool output cannot reset limits or counters even if caller mutates the original settings', async () => {
  const limits = { maxToolCalls: 1 };
  const mcp = new StubMcp(() => { limits.maxToolCalls = 1000; return success({ limits, toolCalls: 0, approved: true }); });
  const h = harness([callsOf(['c1', 'lookup']), callsOf(['c2', 'save'])], mcp, { input: { limits } });
  const result = await run(h);
  assert.equal(result.reason, 'tool_call_limit');
  assert.equal(result.budget.toolCalls, 1);
  assert.equal(mcp.calls.length, 1);
  assert.equal(Object.isFrozen(result.budget), true);
});

test('unknown write cannot be proposed again under a new ID, including in the same batch', async () => {
  const failure = () => { throw new Error('connection lost after write'); };
  for (const frames of [
    [callsOf(['c1', 'save', { text: 'x' }]), callsOf(['c2', 'save', { text: 'x' }])],
    [callsOf(['c1', 'save', { text: 'x' }], ['c2', 'save', { text: 'x' }])],
  ]) {
    const mcp = new StubMcp(failure);
    const h = harness(frames, mcp);
    const result = await run(h);
    assert.deepEqual([result.status, result.reason], ['partial', 'unknown_outcome']);
    assert.equal(mcp.calls.length, 1, 'retryable prose or new model call ID grants no redispatch');
    assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  }
});

test('invalid budgets reject rather than create overflowed timers or disable limits', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveRunLimits({ maxSteps: value }), RangeError);
  }
  assert.throws(() => resolveRunLimits({ maxDurationMs: 2_147_483_648 }), /timer range/);
  assert.equal(Object.isFrozen(resolveRunLimits()), true);
});

test('provider-reported output tokens cannot exceed the requested per-call allowance', async () => {
  const frame = { ...finalText('unexpected provider overflow'), usage: {
    source: 'provider' as const, inputTokens: 20, outputTokens: 101, totalTokens: 121,
  } };
  const result = await run(harness([frame], new StubMcp(() => assert.fail('no tool dispatch'))));
  assert.equal(result.reason, 'model_output_limit');
  assert.equal(result.messages.length, 0);
});

test('output omission retains known error or unknown evidence rather than converting it to success', async () => {
  for (const status of ['error', 'unknown'] as const) {
    const mcp = new StubMcp(() => ({ status,
      content: [{ type: 'text', text: 'x'.repeat(1000) }],
      error: { code: 'transport', message: 'Connection failed', retryable: true },
    }));
    const result = await run(harness([callsOf(['c1', 'save'])], mcp,
      { input: { limits: { maxToolOutputBytes: 100 } } }));
    assert.equal(result.reason, 'tool_output_limit');
    assert.equal(result.toolCalls[0]?.status, status === 'error' ? 'failed' : 'unknown');
    assert.equal(result.messages[1]?.role === 'tool' && result.messages[1].outcome, status);
    assert.equal(mcp.calls.length, 1);
  }
});
