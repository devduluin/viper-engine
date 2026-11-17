import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresMcpConnectionStore } from '../../../src/adapters/persistence/postgres/mcp-connection-store.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { createFingerprint } from '../../../src/shared/fingerprints/fingerprint.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { ARGS, AT, digest, other, owner, proposalSnapshot } from './fixtures.js';
import { pendingApproval } from './approval-fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);
const digestOf = (args: object) => parseArgumentsDigest(createFingerprint(args, APPROVAL_ARGUMENTS_DIGEST));

const pending = (suffix: string, expiresAt?: number) => pendingApproval(db, suffix, expiresAt);

test('the proposal stores exactly what the approver sees; arguments must match the digest', async () => {
  const { s, approvalId, binding, tool, runId } = await pending('snap');
  const stored = await s.approvals.get(owner, approvalId);
  assert.ok(stored.ok);
  assert.deepEqual([stored.value.arguments, stored.value.toolSnapshot], [ARGS, proposalSnapshot.toolSnapshot]);
  const forged = await s.approvals.propose(owner, {
    id: parseId('approval', 'ap-forged'), binding, arguments: { id: 'b' }, toolSnapshot: proposalSnapshot.toolSnapshot,
    expiresAt: AT + 60_000, at: AT, events: [],
  });
  assert.equal(code(forged), 'approval_mismatch');
  await assert.rejects(db.pool.query(`UPDATE viper_engine.approvals SET arguments = '{"id":"evil"}' WHERE id = $1`, [approvalId]), /immutable/);
  assert.ok(tool.connectionId && runId);
});

test('decisions record the deciding actor; duplicate, stale and foreign decisions are refused', async () => {
  const { s, approvalId } = await pending('decide');
  assert.equal(code(await s.approvals.decide(other, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })), 'not_found');
  const accepted = await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] });
  assert.ok(accepted.ok);
  const stored = await s.approvals.get(owner, approvalId);
  assert.ok(stored.ok && stored.value.decidedBy === 'actor-a');
  assert.equal(code(await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })), 'revision_conflict');
  assert.equal(code(await s.approvals.decide(owner, approvalId, { to: 'rejected', expectedRevision: 2, at: AT, events: [] })), 'invalid_transition');
  await assert.rejects(db.pool.query(`UPDATE viper_engine.approvals SET decided_by = 'actor-b' WHERE id = $1`, [approvalId]), /provenance is immutable/);
});

test('a parameter amendment supersedes the old proposal atomically; the old one can never dispatch', async () => {
  const { s, runId, callId, binding, approvalId } = await pending('revise');
  assert.ok((await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })).ok);
  const amended = { id: 'a', note: 'only five' };
  const revision = (expectedRevision: number, overrides = {}) => ({
    expectedRevision, at: AT + 1, newToolCallId: parseId('tool_call', 'call-revise-2'), newApprovalId: parseId('approval', 'ap-revise-2'),
    arguments: amended, argumentsDigest: digestOf(amended), expiresAt: AT + 60_000, events: [], ...overrides,
  });
  assert.equal(code(await s.approvals.revise(owner, approvalId, revision(1))), 'revision_conflict');
  assert.equal(code(await s.approvals.revise(owner, approvalId, revision(2, { argumentsDigest: digest }))), 'approval_mismatch');
  const revised = await s.approvals.revise(owner, approvalId, revision(2));
  assert.ok(revised.ok);
  assert.deepEqual([revised.value.superseded.status, revised.value.superseded.supersededBy], ['superseded', 'ap-revise-2']);
  assert.deepEqual([revised.value.toolCall.status, revised.value.toolCall.argumentsDigest], ['awaiting_approval', digestOf(amended)]);
  assert.deepEqual([revised.value.approval.status, revised.value.approval.arguments], ['pending', amended]);
  const oldCall = await s.calls.get(owner, runId, callId);
  assert.ok(oldCall.ok && oldCall.value.status === 'rejected');
  const consumeOld = await s.approvals.consumeForDispatch(owner, approvalId, { binding, expectedRevision: 3, toolCallExpectedRevision: 3, at: AT + 2, events: [] });
  assert.equal(code(consumeOld), 'invalid_transition');
  assert.equal(code(await s.approvals.revise(owner, approvalId, revision(3))), 'invalid_transition');
});

test('revoked or re-auth-required access blocks proposal and dispatch, leaving the approval intact', async () => {
  const { s, binding, approvalId, runId, callId, tool } = await pending('revoke');
  assert.ok((await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })).ok);
  assert.ok((await s.calls.transition(owner, runId, callId, { to: 'ready', expectedRevision: 2, at: AT, events: [] })).ok);
  assert.ok((await new PostgresMcpConnectionStore(db.pool).revoke(owner, tool.connectionId, AT)).ok);
  const consume = await s.approvals.consumeForDispatch(owner, approvalId, { binding, expectedRevision: 2, toolCallExpectedRevision: 3, at: AT + 1, events: [] });
  assert.equal(code(consume), 'access_revoked');
  const approval = await s.approvals.get(owner, approvalId);
  assert.ok(approval.ok && approval.value.status === 'accepted');
  const call = await s.calls.get(owner, runId, callId);
  assert.ok(call.ok && call.value.status === 'ready' && call.value.attempts === 0);
});

test('the expiry sweeper expires only due live proposals, and expired ones cannot be consumed', async () => {
  const due = await pending('due', AT + 10);
  const accepted = await pending('due-accepted', AT + 20);
  assert.ok((await accepted.s.approvals.decide(owner, accepted.approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })).ok);
  const later = await pending('later', AT + 1_000_000);
  const expired = await due.s.approvals.expireDue(AT + 20, 100);
  assert.ok(expired >= 2);
  for (const [id, status] of [[due.approvalId, 'expired'], [accepted.approvalId, 'expired'], [later.approvalId, 'pending']] as const) {
    const record = await due.s.approvals.get(owner, id);
    assert.ok(record.ok && record.value.status === status, id);
  }
  const consume = await accepted.s.approvals.consumeForDispatch(owner, accepted.approvalId, {
    binding: accepted.binding, expectedRevision: 3, toolCallExpectedRevision: 2, at: AT + 21, events: [],
  });
  assert.equal(code(consume), 'invalid_transition');
  assert.equal(await due.s.approvals.expireDue(AT + 20, 100), 0);
  await assert.rejects(due.s.approvals.expireDue(AT, 0), RangeError);
});
