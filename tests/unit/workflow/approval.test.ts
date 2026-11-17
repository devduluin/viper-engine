import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import { testScope } from '../../support/agent/setup.js';
import { callsOf, finalText, StubMcp, success } from '../runtime/harness.js';
import { accept, approvalAction, workflow } from './fixtures.js';

test('approval is a typed exact-argument proposal; acceptance alone never dispatches', async () => {
  const mcp = new StubMcp(() => success({ id: 'note-1' }));
  const h = workflow([callsOf(['c1', 'save', { text: 'hello' }]), finalText('Saved')], mcp);
  const session = await h.start();
  const initial = session.snapshot(h.input.scope);
  assert.equal(initial.status, 'waiting_for_approval');
  assert.deepEqual(approvalAction(initial).arguments, { text: 'hello' });
  assert.equal(approvalAction(initial).binding.tool.name, 'save');
  const accepted = await session.decideApproval(h.input.scope, accept(initial));
  assert.equal(mcp.calls.length, 0);
  assert.equal(approvalAction(accepted).status, 'accepted');
  const result = await session.resume(h.input.scope, accepted.revision);
  assert.equal(result.status, 'completed');
  assert.equal(mcp.calls.length, 1);
  assert.equal(mcp.calls[0]?.toolCallId, 'c1');
  assert.equal(result.modelCalls, 2);
  assert.equal(result.budget.toolCalls, 1, 'held reservation is not charged twice');
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  await assert.rejects(session.resume(h.input.scope, result.revision), /invalid_state/);
  assert.equal(mcp.calls.length, 1);
});

test('wrong scope, binding and stale approval decisions cannot grant execution', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['c1', 'save'])], mcp);
  const session = await h.start();
  const action = accept(session.snapshot(h.input.scope));
  await assert.rejects(session.decideApproval(testScope('other'), action), /Scope access denied/);
  await assert.rejects(session.decideApproval(h.input.scope, { ...action, expectedRevision: 99 }), /revision_conflict/);
  await assert.rejects(session.decideApproval(h.input.scope, { ...action, binding: { ...action.binding, argumentsDigest: 'b'.repeat(64) as typeof action.binding.argumentsDigest } }), { code: 'approval_mismatch' });
  await assert.rejects(session.resume(h.input.scope, 1), /approval_required/);
  assert.equal(mcp.calls.length, 0);
});

test('revised arguments supersede accepted approval and get fresh call/digest/approval IDs', async () => {
  const mcp = new StubMcp(() => success({ id: 'note-2' }));
  const h = workflow([callsOf(['c1', 'save', { text: 'old' }]), finalText('Saved revised note')], mcp);
  const session = await h.start();
  const original = session.snapshot(h.input.scope);
  const accepted = await session.decideApproval(h.input.scope, accept(original));
  const old = approvalAction(accepted);
  const revised = await session.reviseProposal(h.input.scope, { approvalId: old.approvalId,
    expectedRevision: old.revision, arguments: { text: 'new' } });
  const next = approvalAction(revised);
  assert.notEqual(next.approvalId, old.approvalId);
  assert.notEqual(next.binding.toolCallId, old.binding.toolCallId);
  assert.notEqual(next.binding.argumentsDigest, old.binding.argumentsDigest);
  assert.equal(next.status, 'pending');
  await assert.rejects(session.decideApproval(h.input.scope, accept(original)), /revision_conflict/);
  await assert.rejects(session.resume(h.input.scope, revised.revision), /approval_required/);
  const newlyAccepted = await session.decideApproval(h.input.scope, accept(revised));
  const result = await session.resume(h.input.scope, newlyAccepted.revision);
  assert.equal(result.status, 'completed');
  assert.deepEqual(mcp.calls.map(call => call.arguments), [{ text: 'new' }]);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('rejected approval returns error evidence to the model without invoking MCP', async () => {
  const mcp = new StubMcp(() => assert.fail('rejected action cannot dispatch'));
  const h = workflow([callsOf(['c1', 'save']), finalText('Write declined')], mcp);
  const session = await h.start();
  const rejected = await session.decideApproval(h.input.scope, { ...accept(session.snapshot(h.input.scope)), decision: 'reject' });
  const result = await session.resume(h.input.scope, rejected.revision);
  assert.equal(result.status, 'completed');
  assert.equal(result.toolCalls[0]?.status, 'rejected');
  assert.equal(mcp.calls.length, 0);
});

test('deferred reads execute only after the complete approval batch is decided', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const h = workflow([callsOf(['c1', 'lookup'], ['c2', 'save']), finalText('done')], mcp);
  const session = await h.start();
  assert.equal(mcp.calls.length, 0);
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  const result = await session.resume(h.input.scope, accepted.revision);
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c1', 'c2']);
  assert.deepEqual(result.toolCalls.map(call => call.status), ['succeeded', 'succeeded']);
});
