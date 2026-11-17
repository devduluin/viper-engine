import { parseId } from '../../../contracts/identity/ids.js';
import { scopeFromAuthenticatedIdentity } from '../../../contracts/identity/scope.js';
import { requireState } from '../../../contracts/api/failure.js';
import { asRow, text } from './rows.js';
import { withTransaction } from './sql-client.js';
import type { SqlPool } from './sql-client.js';
import { transactionPool } from './journal-commands.js';
import { PostgresRunStore } from './run-store.js';
import { lockRun } from './run-lock.js';

/** Run -> approval lock order, also used by decisions/consumption. Multiple sweepers skip locks. */
export async function maintainApprovals(pool: SqlPool, limit: number): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid maintenance batch');
  return withTransaction(pool, async tx => {
    const rows = await tx.query(`SELECT r.id, r.actor_id, r.app_id, r.tenant_key FROM viper_engine.runs r
      WHERE r.status = 'waiting_for_approval' AND r.cancel_requested_at IS NULL
      AND EXISTS (SELECT 1 FROM viper_engine.approvals a WHERE a.run_id = r.id AND
        (a.status = 'expired' OR (a.status IN ('pending','accepted') AND a.expires_at <= clock_timestamp())))
      AND NOT EXISTS (SELECT 1 FROM viper_engine.approvals a WHERE a.run_id = r.id
        AND a.status = 'pending' AND a.expires_at > clock_timestamp())
      ORDER BY r.created_at, r.id LIMIT $1 FOR UPDATE OF r SKIP LOCKED`, [limit]);
    const runs = new PostgresRunStore(transactionPool(tx));
    for (const value of rows.rows) {
      const row = asRow(value); const tenant = text(row, 'tenant_key');
      const scope = scopeFromAuthenticatedIdentity({ actorId: parseId('actor', row['actor_id']), appId: parseId('app', row['app_id']),
        ...(tenant === '' ? {} : { tenantId: parseId('tenant', tenant) }) });
      const id = parseId('run', row['id']); const locked = requireState(await lockRun(tx, scope, id));
      await tx.query(`UPDATE viper_engine.approvals SET status = 'expired', revision = revision + 1,
        updated_at = clock_timestamp() WHERE run_id = $1 AND status IN ('pending','accepted') AND expires_at <= clock_timestamp()`, [id]);
      requireState(await runs.wake(scope, id, { expectedRevision: locked.record.revision, at: locked.leaseCheckedAt ?? Date.now(), events: [] }));
    }
    return rows.rows.length;
  });
}
