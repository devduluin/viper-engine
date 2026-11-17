import assert from 'node:assert/strict';
import test from 'node:test';
import { TestClock } from '../../support/agent/identity.js';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import { callsOf, decided, finalText, runtimeTool, StubMcp, success } from '../runtime/harness.js';
import { accept, approvalAction, workflow } from './fixtures.js';

test('completed reads preceding an approval pause are never executed again on resume', async () => {
  const mcp = new StubMcp(() => success({ stock: 5 }));
  const h = workflow([callsOf(['c1', 'lookup']), callsOf(['c2', 'save', { text: 'stock=5' }]), finalText('saved')], mcp);
  const session = await h.start();
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c1']);
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  const result = await session.resume(h.input.scope, accepted.revision);
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c1', 'c2']);
  assert.equal(result.modelCalls, 3);
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.budget.toolCalls, 2);
});

test('unknown write suppression persists across a clarification pause', async () => {
  const mcp = new StubMcp(() => { throw new Error('lost write result'); });
  const h = workflow([callsOf(['c1', 'save', { text: 'x' }]), decided({ kind: 'needs_input', question: 'Continue?' }),
    callsOf(['c2', 'save', { text: 'x' }])], mcp, { deps: { policy: { decide: () => 'execute' } } });
  const session = await h.start();
  const result = await session.submitInput(h.input.scope, { inputId: 'a', expectedRevision: 1, content: [{ type: 'text', text: 'Continue' }] });
  assert.deepEqual([result.status, result.reason], ['partial', 'unknown_outcome']);
  assert.equal(mcp.calls.length, 1);
});

test('approval expiry and the original runtime deadline are never extended by waiting', async () => {
  const clock = new TestClock();
  const mcp = new StubMcp(() => assert.fail('expired approval cannot execute'));
  const h = workflow([callsOf(['c1', 'save'])], mcp, { deps: { clock } });
  const session = await h.start();
  const before = session.snapshot(h.input.scope);
  clock.advance(60_000);
  await assert.rejects(session.decideApproval(h.input.scope, accept(before)), /approval_expired/);
  const expired = await session.resume(h.input.scope, before.revision);
  assert.equal(approvalAction(expired).status, 'expired');
  assert.equal(mcp.calls.length, 0);
  const h2 = workflow([callsOf(['c1', 'save'])], mcp, { input: { limits: { maxDurationMs: 100 } }, deps: { clock } });
  const second = await h2.start();
  const accepted = await second.decideApproval(h2.input.scope, accept(second.snapshot(h2.input.scope)));
  clock.advance(100);
  const result = await second.resume(h2.input.scope, accepted.revision);
  assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(mcp.calls.length, 0);
});

test('changed catalog version invalidates an accepted proposal before dispatch', async () => {
  let changed = false;
  const original = runtimeTool('save');
  const newer = { ...original, definition: { ...original.definition, ref: { ...original.definition.ref, definitionVersion: 'v2' } } };
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['c1', 'save']), finalText('done')], mcp, { input: { tools: [original] }, deps: {
    refreshTools: async () => changed ? [newer] : [original],
  } });
  const session = await h.start();
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  changed = true;
  const invalidated = await session.resume(h.input.scope, accepted.revision);
  const old = approvalAction(invalidated);
  assert.equal(old.status, 'superseded');
  assert.equal(mcp.calls.length, 0);
  const revised = await session.reviseProposal(h.input.scope, { approvalId: old.approvalId, expectedRevision: old.revision, arguments: {} });
  assert.equal(approvalAction(revised).binding.tool.definitionVersion, 'v2');
  const acceptedAgain = await session.decideApproval(h.input.scope, accept(revised));
  const result = await session.resume(h.input.scope, acceptedAgain.revision);
  assert.equal(result.status, 'completed');
  assert.equal(mcp.calls[0]?.tool.definitionVersion, 'v2');
});

test('current access policy can revoke an accepted proposal, without consuming or executing it', async () => {
  let revoked = false;
  const mcp = new StubMcp(() => assert.fail('revoked permission cannot execute'));
  const h = workflow([callsOf(['c1', 'save']), finalText('permission revoked')], mcp,
    { deps: { policy: { decide: () => revoked ? 'reject' : 'requires_approval' } } });
  const session = await h.start();
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  revoked = true;
  const result = await session.resume(h.input.scope, accepted.revision);
  assert.equal(result.toolCalls[0]?.status, 'rejected');
  assert.equal(mcp.calls.length, 0);
});

test('concurrent resumes serialize; a second request cannot duplicate the approved write', async () => {
  let release: () => void = () => assert.fail('not waiting');
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['c1', 'save']), finalText('saved')], mcp, { deps: {
    refreshTools: async () => { await gate; return [runtimeTool('save')]; },
  } });
  const session = await h.start();
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  const first = session.resume(h.input.scope, accepted.revision);
  await assert.rejects(session.resume(h.input.scope, accepted.revision), /run_busy/);
  release();
  assert.equal((await first).status, 'completed');
  assert.equal(mcp.calls.length, 1);
});

test('cancelled pending proposals are paired and cannot be revived', async () => {
  const mcp = new StubMcp(() => assert.fail('cancelled proposal cannot execute'));
  const h = workflow([callsOf(['c1', 'save'], ['c2', 'lookup'])], mcp);
  const session = await h.start();
  const result = await session.cancel(h.input.scope);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.toolCalls.map(call => call.status), ['cancelled', 'cancelled']);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  await assert.rejects(session.resume(h.input.scope, result.revision), /invalid_state/);
});

test('approval expiry or policy revocation during the intent await is checked before gateway invocation', async () => {
  for (const expire of [true, false]) {
    const clock = new TestClock();
    let revoked = false;
    const mcp = new StubMcp(() => assert.fail('final admission must reject'));
    const h = workflow([callsOf(['c1', 'save']), finalText('No write performed')], mcp, { deps: {
      clock, policy: { decide: () => revoked ? 'reject' : 'requires_approval' },
      onEvent: async event => {
        if (event.type !== 'tool_call_dispatching') return;
        await Promise.resolve();
        if (expire) clock.advance(60_000);
        else revoked = true;
      },
    } });
    const session = await h.start();
    const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
    const result = await session.resume(h.input.scope, accepted.revision);
    assert.equal(mcp.calls.length, 0);
    assert.equal(result.toolCalls[0]?.status, 'rejected');
    assert.equal(result.toolCalls[0]?.dispatchState, 'not_sent');
    assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  }
});

test('a persistence sink fault poisons the session before a retry can repeat a remote effect', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['c1', 'save']), finalText('never')], mcp, { deps: { onEvent: event => {
    if (event.type === 'tool_call_dispatching') throw new Error('intent sink failed');
  } } });
  const session = await h.start();
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  await assert.rejects(session.resume(h.input.scope, accepted.revision), /intent sink failed/);
  await assert.rejects(session.resume(h.input.scope, accepted.revision), { code: 'invalid_state' });
  assert.equal(mcp.calls.length, 0);
});

test('initial invocation also respects a policy tightened while awaiting dispatch intent', async () => {
  let restricted = false;
  const mcp = new StubMcp(() => assert.fail('tightened policy requires approval'));
  const h = workflow([callsOf(['c1', 'lookup']), finalText('Approval now required')], mcp, { deps: {
    policy: { decide: () => restricted ? 'requires_approval' : 'execute' },
    onEvent: event => { if (event.type === 'tool_call_dispatching') restricted = true; },
  } });
  const session = await h.start();
  assert.equal(session.snapshot(h.input.scope).toolCalls[0]?.status, 'rejected');
  assert.equal(mcp.calls.length, 0);
});
