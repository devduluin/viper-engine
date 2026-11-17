import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgentLoop } from '../../../src/agent/runtime/run-loop.js';
import { AgentRunSession } from '../../../src/application/runs/session.js';
import { harness, callsOf, finalText, StubMcp, success, decided } from '../runtime/harness.js';
import { contextInput, policy, oldHistory, user, pair } from '../../support/context/history.js';

test('runtime uses bounded context while execution history and call/result evidence stay complete', async () => {
  const input = contextInput(); const mcp = new StubMcp(() => success({ stock: 5 }));
  const h = harness([callsOf(['new-call', 'lookup']), finalText('Evidence confirmed')], mcp,
    { input: { history: input.history, context: policy } });
  const result = await runAgentLoop(h.input, h.deps);
  assert.equal(result.status, 'completed'); assert.equal(mcp.calls.length, 1); assert.equal(h.model.requests.length, 2);
  const first = h.model.requests[0]!; assert.ok(new TextEncoder().encode(JSON.stringify(first)).byteLength <= policy.maxInputBytes);
  const last = h.model.requests[1]!; assert.ok(last.messages.some(message => message.role === 'tool' && message.toolCallId === 'new-call'));
  assert.equal(input.history.messages.length, 17);
  assert.ok(result.messages.every(message => !String(message.id).startsWith('context-')));
  const events = h.events.filter(event => event.type === 'model_call_started');
  assert.ok(events.every(event => event.contextCheckpoint !== undefined && event.contextCheckpoint.report.omittedMessages > 0));
});

test('budget failure happens before model-start or tool-dispatch and has a stable stop reason', async () => {
  const mcp = new StubMcp(() => success({})); const input = contextInput([user('active', 'Required '.repeat(2000))]);
  const h = harness([callsOf(['not-run', 'lookup'])], mcp, { input: { history: input.history, context: policy } });
  const result = await runAgentLoop(h.input, h.deps);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'context_input_limit');
  assert.equal(h.model.requests.length, 0); assert.equal(mcp.calls.length, 0);
  assert.ok(!h.events.some(event => event.type === 'model_call_started'));
});

test('a hidden older call identity still cannot be proposed or dispatched again', async () => {
  const input = contextInput([...pair('old'), ...oldHistory(), user('active', 'New task')]); const mcp = new StubMcp(() => success({}));
  const h = harness([callsOf(['old-call-a', 'lookup'])], mcp, { input: { history: input.history, context: policy } });
  const result = await runAgentLoop(h.input, h.deps);
  assert.equal(result.reason, 'invalid_model_response'); assert.equal(mcp.calls.length, 0);
  assert.ok(h.model.requests[0]!.messages.every(message => !String(message.id).startsWith('old-')));
});

test('in-memory clarification resume retains original active task and the same compression anchor', async () => {
  const input = contextInput(); const mcp = new StubMcp(() => success({}));
  const h = harness([decided({ kind: 'needs_input', question: 'Which item?' }), finalText('Confirmed')], mcp,
    { input: { history: input.history, context: policy } });
  const session = await AgentRunSession.start(h.input, { ...h.deps, refreshTools: async () => h.input.tools });
  const paused = session.snapshot(h.input.scope);
  const resumed = await session.submitInput(h.input.scope, { expectedRevision: paused.revision, inputId: 'context-answer',
    content: [{ type: 'text', text: 'item-a' }] });
  assert.equal(resumed.status, 'completed');
  assert.ok(h.model.requests[1]!.messages.some(message => message.id === 'active-user'));
  const events = h.events.filter(event => event.type === 'model_call_started');
  assert.equal(events[0]?.contextCheckpoint?.preserveFromMessageId, events[1]?.contextCheckpoint?.preserveFromMessageId);
});
