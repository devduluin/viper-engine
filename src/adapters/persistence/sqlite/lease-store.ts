import { parseId } from '../../../contracts/identity/ids.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import { parseLeaseDuration, parseWorkerId } from '../../../contracts/state/leases.js';
import type { LeaseToken, RunClaim, RunLeaseStore } from '../../../contracts/state/leases.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { asRow, integer, runRecord } from '../postgres/rows.js';
import type { SqlitePool } from './pool.js';

const LOST = { code: 'lease_lost', message: 'Run lease is no longer held by this worker' } as const;
const CLAIMABLE = `
  (status IN ('queued','running') OR (status IN ('waiting_for_input','waiting_for_approval','waiting_for_agents') AND cancel_requested_at_ms IS NOT NULL))
  AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
  AND (cancel_requested_at_ms IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM viper_engine.run_deliveries AS d WHERE d.run_id = runs.id AND d.available_at_ms > ?
  ))`;

export class SqliteRunLeaseStore implements RunLeaseStore {
  constructor(private readonly pool: SqlitePool, private readonly clock: () => number = Date.now) {}

  async claimNext(workerId: string, at: number, leaseMs: number): Promise<RunClaim | undefined> {
    parseWorkerId(workerId);
    parseLeaseDuration(leaseMs);
    if (!Number.isSafeInteger(at) || at < 0) throw new RangeError('Invalid claim timestamp');
    return this.pool.transaction(async tx => {
      const now = this.clock();
      const claimed = await tx.query(`UPDATE viper_engine.runs SET lease_owner = ?, lease_fence = lease_fence + 1,
        lease_expires_at_ms = ? WHERE id = (
          SELECT id FROM viper_engine.runs WHERE ${CLAIMABLE} ORDER BY created_at_ms, id LIMIT 1
        ) RETURNING *`, [workerId, now + leaseMs, now, now]);
      const row = claimed.rows[0];
      if (row === undefined) return undefined;
      const record = runRecord(row);
      const data = asRow(row);
      const calls = await tx.query("SELECT id FROM viper_engine.tool_calls WHERE run_id = ? AND status = 'dispatching' ORDER BY id", [record.id]);
      return Object.freeze({
        runId: record.id, conversationId: record.conversationId, owner: record.owner, status: record.status,
        revision: record.revision, lease: Object.freeze({ workerId, fence: integer(data, 'lease_fence') }),
        expiresAt: integer(data, 'lease_expires_at_ms'), cancelRequested: record.cancelRequestedAt !== undefined,
        inFlightToolCalls: Object.freeze(calls.rows.map(call => parseId('tool_call', asRow(call)['id']))),
      });
    });
  }

  async renew(runId: RunId, lease: LeaseToken, at: number, leaseMs: number): Promise<StateResult<{ readonly expiresAt: number }>> {
    parseLeaseDuration(leaseMs);
    return this.pool.transaction(async tx => {
      const now = this.clock();
      const result = await tx.query(`UPDATE viper_engine.runs SET lease_expires_at_ms = max(lease_expires_at_ms, ?)
        WHERE id = ? AND lease_owner = ? AND lease_fence = ? AND lease_expires_at_ms > ? RETURNING lease_expires_at_ms`,
      [now + leaseMs, runId, lease.workerId, lease.fence, Math.max(now, at)]);
      const row = result.rows[0];
      return row === undefined ? stateConflict(LOST) : stateOk({ expiresAt: integer(asRow(row), 'lease_expires_at_ms') });
    });
  }

  async release(runId: RunId, lease: LeaseToken, at: number): Promise<StateResult<{ readonly released: true }>> {
    return this.pool.transaction(async tx => {
      const result = await tx.query(`UPDATE viper_engine.runs SET lease_owner = NULL, lease_expires_at_ms = NULL
        WHERE id = ? AND lease_owner = ? AND lease_fence = ? AND lease_expires_at_ms > ?`,
      [runId, lease.workerId, lease.fence, Math.max(this.clock(), at)]);
      return result.rowCount === 1 ? stateOk({ released: true } as const) : stateConflict(LOST);
    });
  }
}
