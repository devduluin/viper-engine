import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresExecutionLedger } from '../../../src/adapters/persistence/postgres/execution-ledger.js';
import { PostgresIdempotencyStore } from '../../../src/adapters/persistence/postgres/idempotency-store.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, other, owner, seedConnection, seedRun, stores } from './fixtures.js';

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

test('omitting the lease cannot bypass fencing; user cancellation remains available', async () => {
  const { runId } = await seedRun(db.pool, owner, 'lease-omission');
  const tool = await seedConnection(db.pool, owner, 'lease-omission');
  const s = stores(db.pool);
  const callId = parseId('tool_call', 'lease-omission');
  const proposal = { id: callId, runId, stepId: parseId('step', 's'), tool, argumentsDigest: digest, requiresApproval: false, at: AT };
  assert.ok((await s.calls.propose(owner, proposal)).ok);
  assert.ok((await s.calls.transition(owner, runId, callId, { to: 'ready', expectedRevision: 1, at: AT, events: [] })).ok);
  const leases = new PostgresRunLeaseStore(db.pool);
  const claim = await leases.claimNext('review-worker', AT, 1000);
  assert.ok(claim && claim.runId === runId);
  const blocked = [
    await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: AT, events: [] }),
    await s.calls.transition(owner, runId, callId, { to: 'dispatching', expectedRevision: 2, at: AT, events: [] }),
    await s.calls.propose(owner, { ...proposal, id: parseId('tool_call', 'bypass-proposal') }),
    await new PostgresExecutionLedger(db.pool).startStep(owner, { runId, stepId: parseId('step', 'bypass'), stepIndex: 1, at: AT }),
  ];
  assert.ok(blocked.every(result => !result.ok && result.error.code === 'lease_lost'));
  assert.ok((await leases.release(runId, claim.lease, AT)).ok);
  const afterRelease = await s.runs.transition(owner, runId, { to: 'failed', expectedRevision: 2, at: AT, events: [] });
  assert.ok(!afterRelease.ok && afterRelease.error.code === 'lease_lost');
  assert.ok((await s.runs.requestCancellation(owner, runId, AT, [])).ok);
});

test('a lapsed lease cannot be released even before takeover', async () => {
  await db.pool.query(`UPDATE viper_engine.runs SET lease_expires_at = to_timestamp($1 / 1000.0), lease_owner = 'parked'`, [AT + 100000]);
  const { runId } = await seedRun(db.pool, owner, 'lapsed-release');
  const leases = new PostgresRunLeaseStore(db.pool);
  const claim = await leases.claimNext('review-worker', AT, 1000);
  assert.ok(claim && claim.runId === runId);
  const result = await leases.release(runId, claim.lease, AT + 1000);
  assert.ok(!result.ok && result.error.code === 'lease_lost');
});

test('an old request cannot complete or abandon a replacement idempotency generation', async () => {
  const store = new PostgresIdempotencyStore(db.pool);
  const request = { operation: 'runs.create', key: 'generation', fingerprint: 'a'.repeat(64) };
  const first = await store.begin(owner, { ...request, at: AT, ttlMs: 1000 });
  const next = await store.begin(owner, { ...request, at: AT + 1000, ttlMs: 1000 });
  assert.ok(first.ok && first.value.status === 'started' && next.ok && next.value.status === 'started');
  assert.notEqual(first.value.claimId, next.value.claimId);
  const old = { ...request, claimId: first.value.claimId };
  const staleComplete = await store.complete(owner, { ...old, resourceRef: 'old/resource' });
  assert.ok(!staleComplete.ok && staleComplete.error.code === 'idempotency_conflict');
  assert.deepEqual(await store.abandon(owner, old), { ok: true, value: { abandoned: false } });
  assert.ok((await store.complete(owner, { ...request, claimId: next.value.claimId, resourceRef: 'new/resource' })).ok);
  const replay = await store.begin(owner, { ...request, at: AT + 1001, ttlMs: 1000 });
  assert.deepEqual(replay, { ok: true, value: { status: 'replay', resourceRef: 'new/resource' } });
});

test('a backdated event timestamp cannot revive a lease expired by database wall time', async () => {
  await db.pool.query(`UPDATE viper_engine.runs SET lease_expires_at = to_timestamp($1 / 1000.0), lease_owner = 'parked'`, [AT + 100000]);
  const { runId } = await seedRun(db.pool, owner, 'backdated-lease');
  const leases = new PostgresRunLeaseStore(db.pool);
  const claim = await leases.claimNext('review-worker', AT, 1000);
  assert.ok(claim && claim.runId === runId);
  const expiredAt = Date.now() - 5000;
  await db.pool.query('UPDATE viper_engine.runs SET lease_expires_at = to_timestamp($2 / 1000.0) WHERE id = $1', [runId, expiredAt]);
  const at = expiredAt - 1000;
  for (const result of [
    await stores(db.pool).runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at, lease: claim.lease, events: [] }),
    await leases.renew(runId, claim.lease, at, 1000),
    await leases.release(runId, claim.lease, at),
  ]) assert.ok(!result.ok && result.error.code === 'lease_lost');
});

test('terminal runs admit no new execution work; raw provider text never enters failure-code storage', async () => {
  const { runId } = await seedRun(db.pool, owner, 'terminal-ledger');
  const ledger = new PostgresExecutionLedger(db.pool);
  const stepId = parseId('step', 'terminal-ledger');
  assert.ok((await ledger.startStep(owner, { runId, stepId, stepIndex: 1, at: AT })).ok);
  const modelCallId = parseId('model_call', 'terminal-ledger');
  assert.ok((await ledger.startModelCall(owner, { runId, stepId, modelCallId, attempt: 1, provider: 'test', model: 'test', at: AT })).ok);
  assert.ok((await stores(db.pool).runs.transition(owner, runId, { to: 'failed', expectedRevision: 2, at: AT, events: [] })).ok);
  for (const result of [
    await ledger.startStep(owner, { runId, stepId: parseId('step', 'late'), stepIndex: 2, at: AT }),
    await ledger.startModelCall(owner, { runId, stepId, modelCallId: parseId('model_call', 'late'), attempt: 2, provider: 'test', model: 'test', at: AT }),
  ]) assert.ok(!result.ok && result.error.code === 'invalid_transition');
  const usage = { source: 'provider', inputTokens: 1, outputTokens: 2, totalTokens: 3 } as const;
  await assert.rejects(ledger.finishModelCall(owner, { runId, modelCallId, outcome: 'failed', failureCode: 'PRIVATE_PROVIDER_TEXT', usage, at: AT }), /failure code/);
  assert.ok((await ledger.finishModelCall(owner, { runId, modelCallId, outcome: 'failed', failureCode: 'timeout', usage, at: AT })).ok);
});

test('an explicit owner wake resumes a claimed waiting run, fences the paused holder and is CAS guarded', async () => {
  await db.pool.query(`UPDATE viper_engine.runs SET lease_expires_at = to_timestamp($1 / 1000.0), lease_owner = 'parked'`, [AT + 100000]);
  const { runId } = await seedRun(db.pool, owner, 'wake-claimed');
  const s = stores(db.pool);
  const leases = new PostgresRunLeaseStore(db.pool);
  const paused = await leases.claimNext('paused', AT, 30000);
  assert.ok(paused && paused.runId === runId);
  assert.ok((await s.runs.transition(owner, runId, { to: 'waiting_for_approval', expectedRevision: 2, at: AT, events: [], lease: paused.lease })).ok);
  const wake = { expectedRevision: 3, at: AT, events: [] };
  const denied = await s.runs.wake(other, runId, wake);
  assert.ok(!denied.ok && denied.error.code === 'not_found');
  assert.ok((await s.runs.wake(owner, runId, wake)).ok);
  const stale = await s.runs.wake(owner, runId, wake);
  assert.ok(!stale.ok && stale.error.code === 'revision_conflict');
  const duplicate = await s.runs.wake(owner, runId, { ...wake, expectedRevision: 4 });
  assert.ok(!duplicate.ok && duplicate.error.code === 'invalid_transition');
  const oldWrite = await s.runs.transition(owner, runId, { to: 'failed', expectedRevision: 4, at: AT, events: [], lease: paused.lease });
  assert.ok(!oldWrite.ok && oldWrite.error.code === 'lease_lost');
  const next = await leases.claimNext('resumed', AT, 30000);
  assert.ok(next && next.runId === runId && next.lease.fence > paused.lease.fence);
});
