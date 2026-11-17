import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseArgumentsDigest } from '../../../src/contracts/state/approval-state.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, event, other, owner, seedConnection, seedRun, stores, proposalSnapshot } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

async function proposed(suffix: string, requiresApproval: boolean) {
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, `conn-${suffix}`);
  const { runId } = await seedRun(db.pool, owner, suffix);
  const id = parseId('tool_call', `call-${suffix}`);
  const result = await s.calls.propose(owner, {
    id, runId, stepId: parseId('step', `step-${suffix}`), tool, argumentsDigest: digest, requiresApproval, at: AT,
  });
  assert.ok(result.ok);
  return { s, tool, runId, id, call: result.value };
}

test('proposal needs the caller\'s own connection; other owners see not_found', async () => {
  const s = stores(db.pool);
  const foreign = await seedConnection(db.pool, other, 'conn-foreign');
  const { runId } = await seedRun(db.pool, owner, 'foreign');
  const result = await s.calls.propose(owner, {
    id: parseId('tool_call', 'call-foreign'), runId, stepId: parseId('step', 's'), tool: foreign,
    argumentsDigest: digest, requiresApproval: false, at: AT,
  });
  assert.deepEqual(result, { ok: false, error: { code: 'not_found', message: 'Record not found' } });
  const { id, runId: ownRun } = await proposed('visible', false);
  assert.equal((await s.calls.get(other, ownRun, id)).ok, false);
  assert.equal((await s.calls.listByRun(other, ownRun)).ok, false);
});

test('ledger: dispatch increments attempts, evidence gates retry, the approval gate holds', async () => {
  const { s, runId, id } = await proposed('ledger', false);
  const step = (to: string, expectedRevision: number, evidence?: string) => s.calls.transition(owner, runId, id, {
    to: to as 'ready', expectedRevision, at: AT, events: [event('tool.started', { toolCallId: id })],
    ...(evidence === undefined ? {} : { evidence: evidence as 'known_not_applied' }),
  });
  assert.ok((await step('ready', 1)).ok);
  const dispatching = await step('dispatching', 2);
  assert.ok(dispatching.ok && dispatching.value.attempts === 1);
  assert.equal((await step('retry_wait', 3)).ok, false);
  assert.ok((await step('retry_wait', 3, 'known_not_applied')).ok);
  const again = await step('dispatching', 4);
  assert.ok(again.ok && again.value.attempts === 2);
  const listed = await s.calls.listByRun(owner, runId);
  assert.ok(listed.ok && listed.value[0]?.status === 'dispatching');
  const events = await s.events.readAfter(owner, runId, 0, 20);
  assert.ok(events.ok);
  assert.deepEqual(events.value.map(item => item.sequence), [1, 2, 3, 4, 5, 6]);
  const gated = await proposed('gated', true);
  const skip = await gated.s.calls.transition(owner, gated.runId, gated.id, { to: 'ready', expectedRevision: 1, at: AT, events: [] });
  assert.equal(!skip.ok && skip.error.code, 'invalid_transition');
});

test('approval binding must match the call; only one live approval per call', async () => {
  const { s, runId, id, tool } = await proposed('bind', true);
  const binding = { runId, toolCallId: id, tool, argumentsDigest: digest };
  const wrong = await s.approvals.propose(owner, {
    id: parseId('approval', 'ap-wrong'), binding: { ...binding, argumentsDigest: parseArgumentsDigest('b'.repeat(64)) },
    ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [],
  });
  assert.equal(!wrong.ok && wrong.error.code, 'approval_mismatch');
  const first = await s.approvals.propose(owner, { id: parseId('approval', 'ap-1'), binding, ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [event('approval.required')] });
  assert.ok(first.ok && first.value.status === 'pending');
  const second = await s.approvals.propose(owner, { id: parseId('approval', 'ap-2'), binding, ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [] });
  assert.equal(!second.ok && second.error.code, 'invalid_transition');
  assert.equal((await s.approvals.get(other, parseId('approval', 'ap-1'))).ok, false);
});

test('consumeForDispatch commits approval and dispatch together, or neither', async () => {
  const { s, runId, id, tool } = await proposed('consume', true);
  const binding = { runId, toolCallId: id, tool, argumentsDigest: digest };
  const approvalId = parseId('approval', 'ap-consume');
  assert.ok((await s.approvals.propose(owner, { id: approvalId, binding, ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [] })).ok);
  assert.ok((await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT, events: [] })).ok);
  assert.ok((await s.calls.transition(owner, runId, id, { to: 'awaiting_approval', expectedRevision: 1, at: AT, events: [] })).ok);
  assert.ok((await s.calls.transition(owner, runId, id, { to: 'ready', expectedRevision: 2, at: AT, events: [] })).ok);
  const consume = (toolCallExpectedRevision: number) => s.approvals.consumeForDispatch(owner, approvalId, {
    binding, expectedRevision: 2, toolCallExpectedRevision, at: AT + 1, events: [event('tool.started')],
  });
  const stale = await consume(1);
  assert.equal(!stale.ok && stale.error.code, 'revision_conflict');
  const untouched = await s.approvals.get(owner, approvalId);
  assert.ok(untouched.ok && untouched.value.status === 'accepted' && untouched.value.revision === 2);
  const done = await consume(3);
  assert.ok(done.ok && done.value.approval.status === 'consumed' && done.value.toolCall.status === 'dispatching');
  assert.equal(done.value.toolCall.attempts, 1);
  const twice = await consume(4);
  assert.equal(!twice.ok && twice.error.code, 'revision_conflict');
  const row = await db.pool.query('SELECT consumed_at IS NOT NULL AS consumed, decided_at IS NOT NULL AS decided FROM viper_engine.approvals WHERE id = $1', [approvalId]);
  assert.deepEqual(row.rows[0], { consumed: true, decided: true });
});

test('expired approvals cannot be accepted or consumed', async () => {
  const { s, runId, id, tool } = await proposed('expiry', true);
  const binding = { runId, toolCallId: id, tool, argumentsDigest: digest };
  const approvalId = parseId('approval', 'ap-expiry');
  assert.ok((await s.approvals.propose(owner, { id: approvalId, binding, ...proposalSnapshot, expiresAt: AT + 10, at: AT, events: [] })).ok);
  const late = await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT + 10, events: [] });
  assert.equal(!late.ok && late.error.code, 'approval_expired');
  assert.ok((await s.approvals.decide(owner, approvalId, { to: 'accepted', expectedRevision: 1, at: AT + 5, events: [] })).ok);
  const consumed = await s.approvals.consumeForDispatch(owner, approvalId, {
    binding, expectedRevision: 2, toolCallExpectedRevision: 1, at: AT + 10, events: [],
  });
  assert.equal(!consumed.ok && consumed.error.code, 'approval_expired');
});
