import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, seedRun, stores, digest, proposalSnapshot } from './fixtures.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { PostgresWorkerControl } from '../../../src/adapters/persistence/postgres/worker-control.js';
import { pendingApproval } from './approval-fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';

const policy = { baseMs: 1000, maxMs: 60000, authenticationMs: 30000 };

test('durable retry is live-fenced, idempotent per failure generation, DB-timed and bypassed only for cancel', async () => {
  const db = await createDatabase(); const leases = new PostgresRunLeaseStore(db.pool); const control = new PostgresWorkerControl(db.pool, policy);
  try {
    const run = await seedRun(db.pool, owner, 'worker-fence');
    const first = await leases.claimNext('first', Date.now(), 30000); assert.ok(first);
    const one = await control.defer(first, 'authentication_required'); assert.ok(one.ok && one.value.failures === 1);
    const repeated = await control.defer(first, 'authentication_required'); assert.deepEqual(repeated, one);
    assert.ok((await leases.release(run.runId, first.lease, Date.now())).ok);
    assert.equal(await leases.claimNext('next', Date.now(), 30000), undefined);
    assert.equal(await leases.claimNext('future-clock', Date.now() + 864000000, 30000), undefined);
    await stores(db.pool).runs.requestCancellation(owner, run.runId, Date.now(), []);
    const next = await leases.claimNext('cancel', Date.now(), 30000); assert.ok(next?.cancelRequested);
    const stale = await control.defer(first, 'execution_failure'); assert.ok(!stale.ok && stale.error.code === 'lease_lost');
    assert.equal(Number((await db.pool.query('SELECT failures FROM viper_engine.run_deliveries')).rows[0].failures), 1);
    await leases.release(run.runId, next.lease, Date.now());
  } finally { await db.drop(); }
});

test('expired approvals wake atomically with two sweepers and never record dispatch attempts', async () => {
  const db = await createDatabase(); const control = new PostgresWorkerControl(db.pool, policy);
  try {
    const now = Date.now(); const p = await pendingApproval(db, 'worker-expire', now + 2000, now);
    assert.ok((await p.s.runs.transition(owner, p.runId, { to: 'waiting_for_approval', expectedRevision: 2, at: now, events: [] })).ok);
    assert.equal(await control.maintain(10), 0);
    await db.pool.query('SELECT pg_sleep(2.1)');
    const counts = await Promise.all([control.maintain(10), control.maintain(10)]); assert.equal(counts[0]! + counts[1]!, 1);
    const run = await p.s.runs.get(owner, p.runId); assert.ok(run.ok && run.value.status === 'running');
    const approval = await p.s.approvals.get(owner, p.approvalId); assert.ok(approval.ok && approval.value.status === 'expired');
    const call = await p.s.calls.get(owner, p.runId, p.callId); assert.ok(call.ok && call.value.attempts === 0);
    assert.equal(await control.maintain(10), 0);
  } finally { await db.drop(); }
});

test('one fresh pending proposal keeps a mixed-expiry run paused until all decisions permit wake', async () => {
  const db = await createDatabase(); const control = new PostgresWorkerControl(db.pool, policy);
  try {
    const now = Date.now(); const p = await pendingApproval(db, 'worker-mixed', now + 2000, now);
    const call = parseId('tool_call', 'fresh-call');
    assert.ok((await p.s.calls.propose(owner, { id: call, runId: p.runId, stepId: parseId('step', 'fresh-step'),
      tool: p.tool, argumentsDigest: digest, requiresApproval: true, at: now })).ok);
    assert.ok((await p.s.calls.transition(owner, p.runId, call, { to: 'awaiting_approval', expectedRevision: 1, at: now, events: [] })).ok);
    const id = parseId('approval', 'fresh-approval');
    assert.ok((await p.s.approvals.propose(owner, { id, binding: { ...p.binding, toolCallId: call }, ...proposalSnapshot,
      expiresAt: now + 60000, at: now, events: [] })).ok);
    assert.ok((await p.s.runs.transition(owner, p.runId, { to: 'waiting_for_approval', expectedRevision: 2, at: now, events: [] })).ok);
    await db.pool.query('SELECT pg_sleep(2.1)'); assert.equal(await control.maintain(10), 0);
    const before = await p.s.runs.get(owner, p.runId); assert.ok(before.ok && before.value.status === 'waiting_for_approval');
    assert.ok((await p.s.approvals.decide(owner, id, { to: 'rejected', expectedRevision: 1, at: Date.now(), events: [] })).ok);
    assert.equal(await control.maintain(10), 1);
  } finally { await db.drop(); }
});
