import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, seedRun } from './fixtures.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';

test('a fast worker clock cannot steal a live lease and a slow clock cannot hide a DB-expired lease', async () => {
  const db = await createDatabase();
  try {
    const { runId } = await seedRun(db.pool, owner, 'clock-skew');
    const leases = new PostgresRunLeaseStore(db.pool);
    const first = await leases.claimNext('healthy', Date.now(), 30000); assert.ok(first);
    assert.equal(await leases.claimNext('fast-clock', Date.now() + 86400000, 30000), undefined);
    await db.pool.query("UPDATE viper_engine.runs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [runId]);
    const next = await leases.claimNext('slow-clock', Date.now() - 86400000, 30000);
    assert.ok(next && next.lease.fence === first.lease.fence + 1);
    assert.ok(next.expiresAt > Date.now() + 25000);
  } finally { await db.drop(); }
});

test('a backdated renewal cannot shorten the lease or create an already-expired lease', async () => {
  const db = await createDatabase();
  try {
    const { runId } = await seedRun(db.pool, owner, 'renew-skew');
    const leases = new PostgresRunLeaseStore(db.pool);
    const claim = await leases.claimNext('healthy', Date.now(), 30000); assert.ok(claim);
    const renewal = await leases.renew(runId, claim.lease, Date.now() - 86400000, 30000);
    assert.ok(renewal.ok && renewal.value.expiresAt >= claim.expiresAt);
    assert.equal(await leases.claimNext('other', Date.now(), 30000), undefined);
  } finally { await db.drop(); }
});
