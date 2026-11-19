import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresExecutionLedger } from '../../../src/adapters/persistence/postgres/execution-ledger.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { RunId } from '../../../src/contracts/identity/ids.js';
import { createDatabase } from './database.js';
import type { IsolatedDatabase } from './database.js';
import { digest, overlappingPool, owner, seedConnection, seedRun, stores } from './fixtures.js';

const AT = Date.now();

let db: IsolatedDatabase;
before(async () => { db = await createDatabase(); });
after(async () => { await db.drop(); });

const LEASE = 30_000;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

/** Parks every existing run under a far-future lease so each test claims only its own runs. */
async function clearLeases(): Promise<void> {
  await db.pool.query(`UPDATE viper_engine.runs SET lease_owner = 'parked', lease_expires_at = now() + interval '10 years'`);
}

async function freshRun(suffix: string): Promise<RunId> {
  await clearLeases();
  return (await seedRun(db.pool, owner, suffix)).runId;
}

test('concurrent workers never claim the same run; each claim raises the fence', async () => {
  const runs = [await freshRun('c1')];
  for (const suffix of ['c2', 'c3']) runs.push((await seedRun(db.pool, owner, suffix)).runId);
  // Overlapping transactions hold each claimed row locked; SKIP LOCKED lets others take the next run.
  const leases = new PostgresRunLeaseStore(overlappingPool(db.pool));
  const claims = await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5'].map(worker => leases.claimNext(worker, AT, LEASE)));
  const claimed = claims.filter(claim => claim !== undefined);
  assert.equal(claimed.length, 3);
  assert.deepEqual(new Set(claimed.map(claim => claim!.runId)), new Set(runs));
  assert.ok(claimed.every(claim => claim!.lease.fence === 1 && claim!.expiresAt > AT + LEASE && claim!.owner.actorId === 'actor-a'));
  assert.equal(await leases.claimNext('w6', AT + 1_000, LEASE), undefined);
});

test('an expired lease is taken over with a higher fence; the stale worker can no longer write', async () => {
  const runId = await freshRun('takeover');
  const s = stores(db.pool);
  const leases = new PostgresRunLeaseStore(db.pool);
  const first = await leases.claimNext('w-old', AT, LEASE);
  assert.ok(first);
  assert.equal(await leases.claimNext('w-new', AT + LEASE - 1, LEASE), undefined);
  // Expired but not yet taken over: the holder must still stop writing.
  await db.pool.query("UPDATE viper_engine.runs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [runId]);
  const lapsed = await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at: Date.now(), events: [], lease: first.lease });
  assert.equal(code(lapsed), 'lease_lost');
  const second = await leases.claimNext('w-new', AT + LEASE, LEASE);
  assert.ok(second && second.runId === runId && second.lease.fence === first.lease.fence + 1);
  const at = Date.now();
  assert.equal(code(await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at, events: [], lease: first.lease })), 'lease_lost');
  assert.equal(code(await leases.renew(runId, first.lease, at, LEASE)), 'lease_lost');
  assert.equal(code(await leases.release(runId, first.lease, at)), 'lease_lost');
  assert.equal(code(await leases.renew(runId, second.lease, at, LEASE)), 'ok');
  assert.equal(code(await s.runs.transition(owner, runId, { to: 'completed', expectedRevision: 2, at, events: [], lease: second.lease })), 'ok');
});

test('crash window: a dispatching call is reported in flight, can only be reconciled, never re-dispatched', async () => {
  const runId = await freshRun('crash');
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, 'conn-crash');
  const callId = parseId('tool_call', 'call-crash');
  assert.ok((await s.calls.propose(owner, { id: callId, runId, stepId: parseId('step', 's'), tool, argumentsDigest: digest, requiresApproval: false, at: AT })).ok);
  const leases = new PostgresRunLeaseStore(db.pool);
  const dead = await leases.claimNext('w-dead', AT, LEASE);
  assert.ok(dead);
  assert.ok((await s.calls.transition(owner, runId, callId, { to: 'ready', expectedRevision: 1, at: AT, events: [], lease: dead.lease })).ok);
  assert.ok((await s.calls.transition(owner, runId, callId, { to: 'dispatching', expectedRevision: 2, at: AT + 1, events: [], lease: dead.lease })).ok);
  // w-dead crashes here: the remote side effect may or may not have happened.
  await db.pool.query("UPDATE viper_engine.runs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [runId]);
  const heir = await leases.claimNext('w-heir', AT + LEASE + 5, LEASE);
  assert.ok(heir && heir.runId === runId);
  assert.deepEqual(heir.inFlightToolCalls, [callId]);
  const at = Date.now();
  assert.equal(code(await s.calls.transition(owner, runId, callId, { to: 'succeeded', expectedRevision: 3, at, events: [], lease: dead.lease })), 'lease_lost');
  assert.equal(code(await s.calls.transition(owner, runId, callId, { to: 'dispatching', expectedRevision: 3, at, events: [], lease: heir.lease })), 'invalid_transition');
  assert.equal(code(await s.calls.transition(owner, runId, callId, { to: 'unknown', expectedRevision: 3, at, events: [], lease: heir.lease })), 'ok');
  const attempts = await new PostgresExecutionLedger(db.pool).listToolCallAttempts(owner, runId, callId);
  assert.ok(attempts.ok);
  assert.deepEqual(attempts.value.map(item => [item.attempt, item.workerId, item.fence, item.resultKind]), [[1, 'w-dead', dead.lease.fence, 'unknown']]);
});

test('waiting and terminal runs are not claimable; release frees a run but keeps its fence', async () => {
  const runId = await freshRun('waiting');
  const s = stores(db.pool);
  const leases = new PostgresRunLeaseStore(db.pool);
  assert.ok((await s.runs.transition(owner, runId, { to: 'waiting_for_input', expectedRevision: 2, at: AT, events: [] })).ok);
  assert.equal(await leases.claimNext('w', AT, LEASE), undefined);
  assert.ok((await s.runs.transition(owner, runId, { to: 'running', expectedRevision: 3, at: AT, events: [] })).ok);
  const claim = await leases.claimNext('w', AT, LEASE);
  assert.ok(claim);
  assert.equal(code(await leases.release(runId, claim.lease, AT)), 'ok');
  const again = await leases.claimNext('w2', AT + 1, LEASE);
  assert.ok(again && again.lease.fence === claim.lease.fence + 1);
  await assert.rejects(leases.claimNext('bad worker id', AT, LEASE), /worker/);
  await assert.rejects(leases.claimNext('w', AT, 10), RangeError);
  await assert.rejects(db.pool.query(`UPDATE viper_engine.runs SET lease_fence = 0 WHERE id = $1`, [runId]), /fence cannot decrease/);
});
