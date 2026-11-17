import { parseId } from '../../../contracts/identity/ids.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import { parseLeaseDuration, parseWorkerId } from '../../../contracts/state/leases.js';
import type { LeaseToken, RunClaim, RunLeaseStore } from '../../../contracts/state/leases.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { asRow, integer, msColumn, MS_PARAM, RUN_COLUMNS, runRecord } from './rows.js';
import type { SqlPool } from './sql-client.js';
import { withTransaction } from './sql-client.js';

const LOST = Object.freeze({ code: 'lease_lost', message: 'Run lease is no longer held by this worker' } as const);
const CLAIMABLE = `(status IN ('queued', 'running') OR (status IN ('waiting_for_input', 'waiting_for_approval') AND cancel_requested_at IS NOT NULL))
  AND (lease_expires_at IS NULL OR lease_expires_at <= ${MS_PARAM(2)})
  AND (cancel_requested_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM viper_engine.run_deliveries d
    WHERE d.run_id = runs.id AND d.available_at > clock_timestamp()))`;

/**
 * Run claims for durable drivers. `claimNext` uses FOR UPDATE SKIP LOCKED so concurrent workers
 * never claim the same run, and raises `lease_fence` on every claim. Lease columns are not run
 * state: claiming changes neither status nor revision. Waiting runs are not claimable.
 */
export class PostgresRunLeaseStore implements RunLeaseStore {
  constructor(private readonly pool: SqlPool) {}

  async claimNext(workerId: string, at: number, leaseMs: number): Promise<RunClaim | undefined> {
    parseWorkerId(workerId);
    parseLeaseDuration(leaseMs);
    return withTransaction(this.pool, async tx => {
      const claimed = await tx.query(`WITH candidate AS (
          SELECT id FROM viper_engine.runs WHERE ${CLAIMABLE}
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        UPDATE viper_engine.runs AS r SET lease_owner = $1, lease_fence = r.lease_fence + 1,
          lease_expires_at = ${MS_PARAM(2)} + $3::bigint * interval '1 millisecond'
        FROM candidate WHERE r.id = candidate.id RETURNING r.id`, [workerId, at, leaseMs]);
      const claimedId = claimed.rows[0];
      if (claimedId === undefined) return undefined;
      const fresh = await tx.query(`SELECT ${RUN_COLUMNS} FROM viper_engine.runs WHERE id = $1`, [asRow(claimedId)['id']]);
      const row = fresh.rows[0];
      const record = runRecord(row);
      const inFlight = await tx.query(`SELECT id FROM viper_engine.tool_calls WHERE run_id = $1 AND status = 'dispatching' ORDER BY id`, [record.id]);
      const data = asRow(row);
      return Object.freeze({
        runId: record.id, conversationId: record.conversationId, owner: record.owner, status: record.status, revision: record.revision,
        lease: Object.freeze({ workerId, fence: integer(data, 'lease_fence') }), expiresAt: integer(data, 'lease_expires_at_ms'),
        cancelRequested: record.cancelRequestedAt !== undefined,
        inFlightToolCalls: Object.freeze(inFlight.rows.map(call => parseId('tool_call', asRow(call)['id']))),
      });
    });
  }

  /** Extends only a lease that is still held (same worker, same fence, not yet expired). */
  async renew(runId: RunId, lease: LeaseToken, at: number, leaseMs: number): Promise<StateResult<{ readonly expiresAt: number }>> {
    parseLeaseDuration(leaseMs);
    const result = await this.pool.query(`UPDATE viper_engine.runs
      SET lease_expires_at = ${MS_PARAM(4)} + $5::bigint * interval '1 millisecond'
      WHERE id = $1 AND lease_owner = $2 AND lease_fence = $3 AND lease_expires_at > greatest(clock_timestamp(), ${MS_PARAM(4)})
      RETURNING ${msColumn('lease_expires_at')}`, [runId, lease.workerId, lease.fence, at, leaseMs]);
    const row = result.rows[0];
    return row === undefined ? stateConflict(LOST) : stateOk({ expiresAt: integer(asRow(row), 'lease_expires_at_ms') });
  }

  /** Gives the run back early (e.g. after pausing); the fence is kept, so stale tokens stay dead. */
  async release(runId: RunId, lease: LeaseToken, at: number): Promise<StateResult<{ readonly released: true }>> {
    const result = await this.pool.query(`UPDATE viper_engine.runs SET lease_owner = NULL, lease_expires_at = NULL
      WHERE id = $1 AND lease_owner = $2 AND lease_fence = $3 AND lease_expires_at > greatest(clock_timestamp(), ${MS_PARAM(4)})`,
    [runId, lease.workerId, lease.fence, at]);
    return result.rowCount === 1 ? stateOk({ released: true }) : stateConflict(LOST);
  }
}
