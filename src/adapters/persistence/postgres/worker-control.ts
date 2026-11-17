import type { WorkerControl, WorkerFailureCode, WorkerRetryPolicy } from '../../../contracts/worker/control.js';
import type { RunClaim } from '../../../contracts/state/leases.js';
import { scopeFromAuthenticatedIdentity } from '../../../contracts/identity/scope.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import { asRow, integer, ownerColumns } from './rows.js';
import { leaseConflict, lockRun } from './run-lock.js';
import { withTransaction } from './sql-client.js';
import type { SqlPool } from './sql-client.js';
import { maintainApprovals } from './worker-maintenance.js';

function retryMs(policy: WorkerRetryPolicy, failures: number, code: WorkerFailureCode): number {
  const base = code === 'authentication_required' || code === 'invalid_configuration' ? policy.authenticationMs : policy.baseMs;
  return Math.min(policy.maxMs, base * (2 ** Math.min(failures - 1, 30)));
}

/** Global trusted worker adapter; all failed claims still undergo owner and live-fence checks. */
export class PostgresWorkerControl implements WorkerControl {
  constructor(private readonly pool: SqlPool, private readonly policy: WorkerRetryPolicy) {
    this.policy = Object.freeze({ ...policy });
    for (const value of Object.values(policy)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new RangeError('Invalid durable retry delay');
    }
    if (policy.baseMs > policy.maxMs || policy.authenticationMs > policy.maxMs) throw new RangeError('Invalid durable retry range');
  }

  async defer(claim: RunClaim, code: WorkerFailureCode) {
    const scope = scopeFromAuthenticatedIdentity(claim.owner);
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, claim.runId);
      if (!run.ok) return stateConflict<{ failures: number; availableAt: number }>(run.error);
      const lost = leaseConflict(run.value, claim.lease, 0);
      if (lost !== undefined) return stateConflict<{ failures: number; availableAt: number }>(lost);
      const current = await tx.query(`SELECT failures, failed_fence,
        floor(extract(epoch FROM available_at)*1000)::bigint AS available_at_ms FROM viper_engine.run_deliveries WHERE run_id = $1`, [claim.runId]);
      const row = current.rows[0] === undefined ? undefined : asRow(current.rows[0]);
      if (row !== undefined && integer(row, 'failed_fence') === claim.lease.fence) {
        return stateOk({ failures: integer(row, 'failures'), availableAt: integer(row, 'available_at_ms') });
      }
      const failures = row === undefined ? 1 : integer(row, 'failures') + 1;
      const result = await tx.query(`INSERT INTO viper_engine.run_deliveries
        (run_id, actor_id, app_id, tenant_key, failures, failed_fence, available_at, failure_code)
        VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp() + $7::bigint * interval '1 millisecond',$8)
        ON CONFLICT (run_id) DO UPDATE SET failures = EXCLUDED.failures, failed_fence = EXCLUDED.failed_fence,
          available_at = EXCLUDED.available_at, failure_code = EXCLUDED.failure_code
        RETURNING floor(extract(epoch FROM available_at)*1000)::bigint AS available_at_ms`,
      [claim.runId, ...ownerColumns(scope), failures, claim.lease.fence, retryMs(this.policy, failures, code), code]);
      return stateOk({ failures, availableAt: integer(asRow(result.rows[0]), 'available_at_ms') });
    });
  }

  maintain(limit: number) { return maintainApprovals(this.pool, limit); }
}
