import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { checkToolCallTransition, TOOL_CALL_TRANSITIONS } from '../../../src/contracts/state/tool-call-state.js';
import type { ToolCallStatus } from '../../../src/contracts/state/tool-call-state.js';
import {
  applyApprovalTransition, applyToolCallTransition, consumeApproval,
} from '../../../src/contracts/state/transitions.js';
import { approvalRecord, binding, digestB, scope, T0, toolCallRecord, toolRef } from './fixtures.js';

function reachable(from: ToolCallStatus): Set<ToolCallStatus> {
  const seen = new Set<ToolCallStatus>();
  const queue = [from];
  while (queue.length > 0) {
    for (const rule of TOOL_CALL_TRANSITIONS[queue.shift() as ToolCallStatus]) {
      if (!seen.has(rule.to)) { seen.add(rule.to); queue.push(rule.to); }
    }
  }
  return seen;
}

test('after dispatch intent no path leads back to ready or awaiting approval', () => {
  for (const from of ['dispatching', 'retry_wait', 'unknown'] as const) {
    const targets = reachable(from);
    assert.equal(targets.has('ready'), false, from);
    assert.equal(targets.has('awaiting_approval'), false, from);
  }
  assert.equal(reachable('unknown').has('dispatching'), false, 'unknown outcome is never redispatched');
});

test('evidence-gated transitions: retry needs known_not_applied, unknown needs reconciliation', () => {
  assert.equal(checkToolCallTransition('dispatching', 'retry_wait')?.code, 'evidence_required');
  assert.equal(checkToolCallTransition('dispatching', 'retry_wait', 'reconciliation')?.code, 'evidence_required');
  assert.equal(checkToolCallTransition('dispatching', 'retry_wait', 'known_not_applied'), undefined);
  for (const to of ['succeeded', 'failed'] as const) {
    assert.equal(checkToolCallTransition('unknown', to)?.code, 'evidence_required');
    assert.equal(checkToolCallTransition('unknown', to, 'reconciliation'), undefined);
  }
  assert.equal(checkToolCallTransition('dispatching', 'cancelled')?.code, 'invalid_transition');
});

test('dispatching increments attempts on every dispatch and revision on every write', () => {
  let record = toolCallRecord({ status: 'ready' });
  const steps = [
    { to: 'dispatching' }, { to: 'retry_wait', evidence: 'known_not_applied' }, { to: 'dispatching' }, { to: 'unknown' },
  ] as const;
  for (const step of steps) {
    const result = applyToolCallTransition(record, scope(), { expectedRevision: record.revision, at: T0, ...step });
    assert.ok(result.ok, step.to);
    if (result.ok) record = result.value;
  }
  assert.equal(record.attempts, 2);
  assert.equal(record.revision, 5);
  assert.equal(record.status, 'unknown');
});

test('approval-required calls cannot skip awaiting_approval', () => {
  const gated = toolCallRecord({ requiresApproval: true });
  const skip = applyToolCallTransition(gated, scope(), { expectedRevision: 1, to: 'ready', at: T0 });
  assert.equal(skip.ok ? undefined : skip.error.code, 'invalid_transition');
  assert.ok(applyToolCallTransition(gated, scope(), { expectedRevision: 1, to: 'awaiting_approval', at: T0 }).ok);
  const free = applyToolCallTransition(toolCallRecord(), scope(), { expectedRevision: 1, to: 'ready', at: T0 });
  assert.ok(free.ok);
});

test('approval acceptance respects expiry and terminal decisions are final', () => {
  const accepted = applyApprovalTransition(approvalRecord(), scope(), { expectedRevision: 1, to: 'accepted', at: T0 + 1 });
  assert.ok(accepted.ok);
  const late = applyApprovalTransition(approvalRecord(), scope(), { expectedRevision: 1, to: 'accepted', at: T0 + 60_000 });
  assert.equal(late.ok ? undefined : late.error.code, 'approval_expired');
  const rejected = approvalRecord({ status: 'rejected' });
  const flip = applyApprovalTransition(rejected, scope(), { expectedRevision: 1, to: 'accepted', at: T0 });
  assert.equal(flip.ok ? undefined : flip.error.code, 'invalid_transition');
  const foreign = applyApprovalTransition(approvalRecord(), scope('actor-2'), { expectedRevision: 1, to: 'accepted', at: T0 });
  assert.equal(foreign.ok ? undefined : foreign.error.code, 'not_found');
});

test('consumption is single use, unexpired and bound to the exact call', () => {
  const accepted = approvalRecord({ status: 'accepted', revision: 2 });
  const consume = (record = accepted, candidate = binding(), at = T0 + 1) =>
    consumeApproval(record, scope(), { expectedRevision: record.revision, binding: candidate, at });
  const first = consume();
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.value.status, 'consumed');
  const second = consume(first.value);
  assert.equal(second.ok ? undefined : second.error.code, 'invalid_transition');
  const pending = consume(approvalRecord());
  assert.equal(pending.ok ? undefined : pending.error.code, 'invalid_transition');
  const expired = consume(accepted, binding(), T0 + 60_000);
  assert.equal(expired.ok ? undefined : expired.error.code, 'approval_expired');
});

test('any binding change, including revised arguments or tool version, fails consumption', () => {
  const accepted = approvalRecord({ status: 'accepted', revision: 2 });
  const variants = [
    binding({ argumentsDigest: digestB }),
    binding({ runId: parseId('run', 'run-2') }),
    binding({ toolCallId: parseId('tool_call', 'call-2') }),
    binding({ tool: toolRef({ definitionVersion: 'v2' }) }),
    binding({ tool: toolRef({ name: 'delete_invoice' }) }),
    binding({ tool: toolRef({ connectionId: parseId('mcp_connection', 'conn-2') }) }),
    binding({ tool: toolRef({ serverId: parseId('mcp_server', 'server-2') }) }),
  ];
  for (const candidate of variants) {
    const result = consumeApproval(accepted, scope(), { expectedRevision: 2, binding: candidate, at: T0 + 1 });
    assert.equal(result.ok ? undefined : result.error.code, 'approval_mismatch');
  }
});

test('arguments digest must be a full lowercase SHA-256 hex string', () => {
  for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(8), 42]) {
    assert.throws(() => parseArgumentsDigest(bad), /64 lowercase hex/);
  }
});
