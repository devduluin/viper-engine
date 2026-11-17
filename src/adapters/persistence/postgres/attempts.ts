import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { AttemptResultKind } from '../../../contracts/state/execution-records.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import type { ToolCallRecord } from '../../../contracts/state/records.js';
import { MS_PARAM, ownerColumns } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

const SETTLING: ReadonlySet<string> = new Set<AttemptResultKind>(['succeeded', 'failed', 'unknown', 'retry_wait']);

/**
 * Keeps `tool_call_attempts` in step with the tool-call row, in the same transaction:
 * entering `dispatching` opens attempt N (dispatch intent, with the writer's lease); leaving
 * `dispatching` settles it with the outcome kind. Reconciling `unknown` later does not reopen it.
 */
export async function recordAttempt(
  tx: SqlQueryable, scope: TrustedScope, before: ToolCallRecord, after: ToolCallRecord, lease: LeaseToken | undefined,
): Promise<void> {
  if (after.status === 'dispatching') {
    await tx.query(`INSERT INTO viper_engine.tool_call_attempts (run_id, tool_call_id, attempt, actor_id, app_id, tenant_key,
        worker_id, lease_fence, dispatched_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${MS_PARAM(9)})`, [
      after.runId, after.id, after.attempts, ...ownerColumns(scope), lease?.workerId ?? null, lease?.fence ?? null, after.updatedAt,
    ]);
    return;
  }
  if (before.status !== 'dispatching' || !SETTLING.has(after.status)) return;
  const settled = await tx.query(`UPDATE viper_engine.tool_call_attempts SET settled_at = ${MS_PARAM(4)}, result_kind = $3
    WHERE run_id = $1 AND tool_call_id = $2 AND attempt = $5 AND settled_at IS NULL`,
  [after.runId, after.id, after.status, after.updatedAt, before.attempts]);
  if (settled.rowCount !== 1) throw new Error('Open tool call attempt is missing');
}
