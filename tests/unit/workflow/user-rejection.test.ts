import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callsOf, finalText, StubMcp, success, harness, run } from '../runtime/harness.js';
import { accept, workflow } from './fixtures.js';
import { TestClock } from '../../support/agent/identity.js';
import type { ToolCallDecision } from '../../../src/agent/execution/plan-call.js';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';

test('declined approval is explicit not-dispatched evidence in the next model request and report', async () => {
  const mcp = new StubMcp(() => assert.fail('user rejected action'));
  const h = workflow([callsOf(['declined', 'save', { count: 5 }]), finalText('Action declined')], mcp);
  const session = await h.start(); const before = session.snapshot(h.input.scope);
  const rejected = await session.decideApproval(h.input.scope, { ...accept(before), decision: 'reject' });
  const final = await session.resume(h.input.scope, rejected.revision);
  assert.equal(final.status, 'completed'); assert.equal(final.toolCalls[0]?.failureCode, 'rejected_by_user');
  const result = h.model.requests[1]!.messages.find(message => message.role === 'tool');
  assert.match(JSON.stringify(result), /rejected_by_user/); assert.match(JSON.stringify(result), /not_dispatched/);
  assert.ok(!JSON.stringify(result).includes('permission')); assert.equal(mcp.calls.length, 0); assert.equal(final.budget.corrections, 0);
  assertMessageHistory(h.model.requests[1]!.messages, { allowPendingToolCalls: false });
});

test('a rejected decision does not expire into another approval wait or permission denial', async () => {
  const clock = new TestClock(); const mcp = new StubMcp(() => assert.fail('rejected action'));
  const h = workflow([callsOf(['declined', 'save']), finalText('Declined')], mcp, { deps: { clock } });
  const session = await h.start(); const rejected = await session.decideApproval(h.input.scope,
    { ...accept(session.snapshot(h.input.scope)), decision: 'reject' });
  clock.advance(61000);
  const final = await session.resume(h.input.scope, rejected.revision);
  assert.equal(final.status, 'completed'); assert.equal(final.toolCalls[0]?.failureCode, 'rejected_by_user'); assert.equal(mcp.calls.length, 0);
});

test('relaxed host policy cannot override an exact rejected proposal; current policy denial keeps its meaning', async () => {
  for (const nextPolicy of ['execute', 'reject'] as const) {
    let decision: ToolCallDecision = 'requires_approval'; const mcp = new StubMcp(() => assert.fail('denied action'));
    const h = workflow([callsOf(['declined', 'save']), finalText('No action')], mcp, { deps: { policy: { decide: () => decision } } });
    const session = await h.start(); const rejected = await session.decideApproval(h.input.scope,
      { ...accept(session.snapshot(h.input.scope)), decision: 'reject' });
    decision = nextPolicy;
    const final = await session.resume(h.input.scope, rejected.revision);
    assert.equal(final.toolCalls[0]?.failureCode, nextPolicy === 'execute' ? 'rejected_by_user' : 'permission'); assert.equal(mcp.calls.length, 0);
  }
});

test('mixed batch executes only the accepted call and retains distinct rejection evidence', async () => {
  const mcp = new StubMcp(() => success({ applied: true }));
  const h = workflow([callsOf(['first', 'save', { count: 1 }], ['second', 'save', { count: 2 }]), finalText('Only second applied')], mcp);
  const session = await h.start(); const initial = session.snapshot(h.input.scope);
  const approvals = initial.actions.filter(action => action.kind === 'approval_required'); assert.equal(approvals.length, 2);
  let view = initial;
  for (const action of approvals) {
    view = await session.decideApproval(h.input.scope, { approvalId: action.approvalId, expectedRevision: action.revision,
      binding: action.binding, decision: action.binding.toolCallId === 'first' ? 'reject' : 'accept' });
  }
  const final = await session.resume(h.input.scope, view.revision);
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['second']);
  assert.equal(final.toolCalls.find(call => call.id === 'first')?.failureCode, 'rejected_by_user');
  assert.equal(final.toolCalls.find(call => call.id === 'second')?.status, 'succeeded');
});

test('rejection explanations never run for allowed calls or bypass argument validation', async () => {
  let explanations = 0; const mcp = new StubMcp(() => success({}));
  const policy = { decide: () => 'execute' as const, rejection: () => { explanations++; return { code: 'rejected_by_user' as const, message: 'Should be unused' }; } };
  const h = harness([callsOf(['allowed', 'lookup']), finalText('done')], mcp, { deps: { policy } });
  assert.equal((await run(h)).status, 'completed'); assert.equal(explanations, 0); assert.equal(mcp.calls.length, 1);
  const invalid = harness([callsOf(['invalid', 'lookup']), finalText('invalid')], mcp, { deps: { policy: { ...policy, decide: () => 'reject' },
    validator: { validate: () => ({ ok: false, message: 'Invalid input' }) } } });
  assert.equal((await run(invalid)).toolCalls[0]?.failureCode, 'invalid_value'); assert.equal(explanations, 0);
});
