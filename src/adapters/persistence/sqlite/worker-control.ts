import { scopeFromAuthenticatedIdentity } from '../../../contracts/identity/scope.js';
import { requireState } from '../../../contracts/api/failure.js';
import type { RunClaim } from '../../../contracts/state/leases.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import type { WorkerControl, WorkerFailureCode, WorkerRetryPolicy } from '../../../contracts/worker/control.js';
import { transactionPool } from '../postgres/journal-commands.js';
import { leaseConflict } from '../postgres/run-lock.js';
import { asRow, integer, ownerColumns, runRecord } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool } from '../postgres/sql-client.js';
import { lockRun, SqliteRunStore } from './run-store.js';

type Delivery = { readonly failures: number; readonly availableAt: number };

export class SqliteWorkerControl implements WorkerControl {
  constructor(private readonly pool: SqlPool, private readonly policy: WorkerRetryPolicy, private readonly clock: () => number = Date.now) {
    this.policy = Object.freeze({ ...policy });
    for (const value of Object.values(policy)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new RangeError('Invalid durable retry delay');
    }
    if (policy.baseMs > policy.maxMs || policy.authenticationMs > policy.maxMs) throw new RangeError('Invalid durable retry range');
  }

  async defer(claim: RunClaim, code: WorkerFailureCode): Promise<StateResult<Delivery>> {
    const scope = scopeFromAuthenticatedIdentity(claim.owner);
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, claim.runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const lost = leaseConflict(run.value, claim.lease, 0);
      if (lost !== undefined) return stateConflict(lost);
      const result = await tx.query('SELECT failures, failed_fence, available_at_ms FROM viper_engine.run_deliveries WHERE run_id = ?', [claim.runId]);
      const row = result.rows[0] === undefined ? undefined : asRow(result.rows[0]);
      if (row !== undefined && integer(row, 'failed_fence') === claim.lease.fence) {
        return stateOk({ failures: integer(row, 'failures'), availableAt: integer(row, 'available_at_ms') });
      }
      const failures = row === undefined ? 1 : integer(row, 'failures') + 1;
      const base = code === 'authentication_required' || code === 'invalid_configuration' ? this.policy.authenticationMs : this.policy.baseMs;
      const availableAt = this.clock() + Math.min(this.policy.maxMs, base * (2 ** Math.min(failures - 1, 30)));
      await tx.query(`INSERT INTO viper_engine.run_deliveries (run_id, actor_id, app_id, tenant_key, failures, failed_fence, available_at_ms, failure_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET failures = excluded.failures,
        failed_fence = excluded.failed_fence, available_at_ms = excluded.available_at_ms, failure_code = excluded.failure_code`,
      [claim.runId, ...ownerColumns(scope), failures, claim.lease.fence, availableAt, code]);
      return stateOk({ failures, availableAt });
    });
  }

  async maintain(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid maintenance batch');
    return withTransaction(this.pool, async tx => {
      const now = this.clock();
      const pending = await tx.query(`SELECT r.* FROM viper_engine.runs r
        WHERE r.status = 'waiting_for_approval' AND r.cancel_requested_at_ms IS NULL
        AND EXISTS (SELECT 1 FROM viper_engine.approvals a WHERE a.run_id = r.id
          AND (a.status = 'expired' OR (a.status IN ('pending','accepted') AND a.expires_at_ms <= ?)))
        AND NOT EXISTS (SELECT 1 FROM viper_engine.approvals a WHERE a.run_id = r.id
          AND a.status = 'pending' AND a.expires_at_ms > ?) ORDER BY r.created_at_ms, r.id LIMIT ?`, [now, now, limit]);
      const runs = new SqliteRunStore(transactionPool(tx), this.clock);
      for (const row of pending.rows) {
        const record = runRecord(row);
        const scope = scopeFromAuthenticatedIdentity(record.owner);
        const id = record.id;
        await tx.query(`UPDATE viper_engine.approvals SET status = 'expired', revision = revision + 1, updated_at_ms = ?
          WHERE run_id = ? AND status IN ('pending','accepted') AND expires_at_ms <= ?`, [now, id, now]);
        requireState(await runs.wake(scope, id, { at: now, expectedRevision: record.revision, events: [] }));
      }
      return pending.rows.length;
    });
  }
}
