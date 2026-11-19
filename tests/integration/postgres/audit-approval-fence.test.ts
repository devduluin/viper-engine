import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, seedRun, seedConnection, stores, digest, proposalSnapshot } from './fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { PostgresRunLeaseStore } from '../../../src/adapters/persistence/postgres/lease-store.js';

test('approval proposals require the current live lease after a run has been claimed', async () => {
  const db = await createDatabase();
  try {
    const { runId } = await seedRun(db.pool, owner, 'approval-fence'); const s = stores(db.pool);
    const tool = await seedConnection(db.pool, owner, 'audit-connection');
    const callId = parseId('tool_call', 'audit-call'); const at = Date.now();
    assert.ok((await s.calls.propose(owner, { id: callId, runId, stepId: parseId('step', 'audit-step'),
      tool, argumentsDigest: digest, requiresApproval: true, at })).ok);
    const leases = new PostgresRunLeaseStore(db.pool);
    const first = await leases.claimNext('old', at, 30000); assert.ok(first);
    const expire = () => db.pool.query("UPDATE viper_engine.runs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [runId]);
    await expire(); const next = await leases.claimNext('new', at, 30000); assert.ok(next);
    const input = { id: parseId('approval', 'audit-approval'), ...proposalSnapshot,
      binding: { runId, toolCallId: callId, tool, argumentsDigest: digest }, at, expiresAt: at + 60000,
      events: [{ eventId: parseId('run_event', 'audit-event'), type: 'approval.required' as const, occurredAt: at, payload: {} }] };
    for (const extra of [{}, { lease: first.lease }]) {
      const refused = await s.approvals.propose(owner, { ...input, ...extra });
      assert.ok(!refused.ok && refused.error.code === 'lease_lost');
    }
    await expire();
    const expired = await s.approvals.propose(owner, { ...input, lease: next.lease });
    assert.ok(!expired.ok && expired.error.code === 'lease_lost');
    assert.equal((await db.pool.query('SELECT id FROM viper_engine.approvals WHERE run_id = $1', [runId])).rows.length, 0);
    assert.equal((await db.pool.query('SELECT event_id FROM viper_engine.run_events WHERE event_id = $1', ['audit-event'])).rows.length, 0);
    const current = await leases.claimNext('current', at, 30000); assert.ok(current);
    assert.ok((await s.approvals.propose(owner, { ...input, lease: current.lease })).ok);
  } finally { await db.drop(); }
});
