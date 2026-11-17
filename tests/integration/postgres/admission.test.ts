import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { ToolCallStatus } from '../../../src/contracts/state/tool-call-state.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, event, overlappingPool, owner, seedConnection, seedRun, stores, proposalSnapshot } from './fixtures.js';

// Regression suite for docs/reviews/P04-01.md (admission, approval bypass, unique masking).
let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

async function setup(suffix: string, requiresApproval: boolean, calls = 1) {
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, `conn-${suffix}`);
  const { runId } = await seedRun(db.pool, owner, suffix);
  const ids = Array.from({ length: calls }, (_, index) => parseId('tool_call', `call-${suffix}-${index}`));
  for (const id of ids) {
    const proposed = await s.calls.propose(owner, { id, runId, stepId: parseId('step', 's'), tool, argumentsDigest: digest, requiresApproval, at: AT });
    assert.ok(proposed.ok);
  }
  let revisions = ids.map(() => 1);
  const move = async (index: number, to: ToolCallStatus) => {
    const result = await s.calls.transition(owner, runId, ids[index]!, { to, expectedRevision: revisions[index]!, at: AT, events: [] });
    if (result.ok) revisions = revisions.map((value, i) => (i === index ? value + 1 : value));
    return result;
  };
  return { s, tool, runId, ids, move, revision: (index: number) => revisions[index]! };
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

test('a terminal run admits no new proposal', async () => {
  const { s, tool, runId, move } = await setup('terminal', false);
  assert.equal(code(await move(0, 'cancelled')), 'ok');
  assert.equal(code(await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: AT, events: [] })), 'ok');
  const late = await s.calls.propose(owner, {
    id: parseId('tool_call', 'call-late'), runId, stepId: parseId('step', 's'), tool, argumentsDigest: digest, requiresApproval: false, at: AT,
  });
  assert.equal(code(late), 'invalid_transition');
});

test('cancellation intent blocks new dispatch but still records outcomes of dispatched calls', async () => {
  const { s, runId, move } = await setup('cancel', false, 2);
  for (const index of [0, 1]) assert.equal(code(await move(index, 'ready')), 'ok');
  assert.equal(code(await move(0, 'dispatching')), 'ok');
  assert.equal(code(await s.runs.requestCancellation(owner, runId, AT, [event('run.cancelled')])), 'ok');
  assert.equal(code(await move(1, 'dispatching')), 'invalid_transition');
  assert.equal(code(await move(0, 'unknown')), 'ok');
  assert.equal(code(await move(1, 'cancelled')), 'ok');
  const calls = await s.calls.listByRun(owner, runId);
  assert.ok(calls.ok);
  assert.deepEqual(calls.value.map(call => [call.status, call.attempts]), [['unknown', 1], ['cancelled', 0]]);
});

test('cancel that wins the run lock first prevents a concurrent dispatch', async () => {
  const { runId, ids, revision } = await setup('race', false);
  const s = stores(db.pool);
  assert.equal(code(await s.calls.transition(owner, runId, ids[0]!, { to: 'ready', expectedRevision: revision(0), at: AT, events: [] })), 'ok');
  const slow = stores(overlappingPool(db.pool, 300));
  const cancel = slow.runs.requestCancellation(owner, runId, AT, []);
  await new Promise(resolve => setTimeout(resolve, 50));
  const dispatch = s.calls.transition(owner, runId, ids[0]!, { to: 'dispatching', expectedRevision: 2, at: AT, events: [] });
  const [cancelled, dispatched] = await Promise.all([cancel, dispatch]);
  assert.equal(code(cancelled), 'ok');
  assert.equal(code(dispatched), 'invalid_transition');
});

test('approval-required calls cannot be dispatched through the plain ledger', async () => {
  const { runId, move } = await setup('bypass', true);
  assert.equal(code(await move(0, 'awaiting_approval')), 'ok');
  assert.equal(code(await move(0, 'ready')), 'ok');
  assert.equal(code(await move(0, 'dispatching')), 'invalid_transition');
  const approvals = await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.approvals WHERE run_id = $1', [runId]);
  assert.equal(approvals.rows[0].n, 0);
});

async function accepted(suffix: string, decision: 'accepted' | 'rejected' | 'superseded' = 'accepted') {
  const context = await setup(suffix, true);
  const { s, runId, ids, tool, move } = context;
  const binding = { runId, toolCallId: ids[0]!, tool, argumentsDigest: digest };
  const approvalId = parseId('approval', `ap-${suffix}`);
  assert.ok((await s.approvals.propose(owner, { id: approvalId, binding, ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [] })).ok);
  assert.ok((await s.approvals.decide(owner, approvalId, { to: decision, expectedRevision: 1, at: AT, events: [] })).ok);
  assert.equal(code(await move(0, 'awaiting_approval')), 'ok');
  assert.equal(code(await move(0, 'ready')), 'ok');
  const consume = (store = s, at = AT + 1) => store.approvals.consumeForDispatch(owner, approvalId, {
    binding, expectedRevision: 2, toolCallExpectedRevision: 3, at, events: [],
  });
  return { ...context, approvalId, consume };
}

test('rejected, superseded, expired and cancelled-run approvals are not consumable', async () => {
  for (const decision of ['rejected', 'superseded'] as const) {
    const { consume } = await accepted(`not-${decision}`, decision);
    assert.equal(code(await consume()), 'invalid_transition');
  }
  const expired = await accepted('expired');
  assert.equal(code(await expired.consume(expired.s, AT + 60_000)), 'approval_expired');
  const cancelled = await accepted('cancelled-run');
  assert.ok((await cancelled.s.runs.requestCancellation(owner, cancelled.runId, AT, [])).ok);
  assert.equal(code(await cancelled.consume()), 'invalid_transition');
  const approval = await cancelled.s.approvals.get(owner, cancelled.approvalId);
  assert.ok(approval.ok && approval.value.status === 'accepted');
});

test('concurrent consumption dispatches exactly once', async () => {
  const { consume, s, runId } = await accepted('double');
  const racing = stores(overlappingPool(db.pool));
  const results = await Promise.all([consume(racing), consume(racing), consume(s)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  const calls = await s.calls.listByRun(owner, runId);
  assert.ok(calls.ok && calls.value[0]?.attempts === 1);
});

test('unrelated unique violations are faults, not "live approval exists"', async () => {
  const { s, runId, ids, tool } = await setup('unique', true, 2);
  const binding = (index: number) => ({ runId, toolCallId: ids[index]!, tool, argumentsDigest: digest });
  const used = event('approval.required');
  assert.ok((await s.approvals.propose(owner, { id: parseId('approval', 'ap-u1'), binding: binding(0), ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [used] })).ok);
  await assert.rejects(s.approvals.propose(owner, { id: parseId('approval', 'ap-u2'), binding: binding(1), ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [used] }),
    (error: { code?: string; constraint?: string }) => error.code === '23505' && error.constraint === 'run_events_event_id_key');
  await assert.rejects(s.approvals.propose(owner, { id: parseId('approval', 'ap-u1'), binding: binding(1), ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [] }),
    (error: { code?: string; constraint?: string }) => error.code === '23505' && error.constraint === 'approvals_pkey');
  const live = await s.approvals.propose(owner, { id: parseId('approval', 'ap-u3'), binding: binding(0), ...proposalSnapshot, expiresAt: AT + 60_000, at: AT, events: [] });
  assert.equal(code(live), 'invalid_transition');
  const count = await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.approvals WHERE run_id = $1', [runId]);
  assert.equal(count.rows[0].n, 1);
});
