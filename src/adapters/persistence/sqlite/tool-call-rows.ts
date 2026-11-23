import type { RunId, ToolCallId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import type { ToolCallRecord } from '../../../contracts/state/records.js';
import { asRow, ownerColumns, toolCallRecord } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';

const SETTLING = new Set(['succeeded', 'failed', 'unknown', 'retry_wait']);

export function callRecord(value: unknown): ToolCallRecord {
  const row = asRow(value);
  const approval = row['requires_approval'];
  if (approval !== 0 && approval !== 1) throw new Error('Invalid SQLite approval flag');
  return toolCallRecord({ ...row, requires_approval: approval === 1 });
}

export async function lockCall(tx: SqlQueryable, runId: RunId, id: ToolCallId) {
  const result = await tx.query('SELECT * FROM viper_engine.tool_calls WHERE run_id = ? AND id = ?', [runId, id]);
  return result.rows[0] === undefined ? undefined : callRecord(result.rows[0]);
}

export async function writeCall(tx: SqlQueryable, before: ToolCallRecord, after: ToolCallRecord) {
  const result = await tx.query(`UPDATE viper_engine.tool_calls SET status = ?, attempts = ?, revision = ?, updated_at_ms = ?
    WHERE run_id = ? AND id = ? AND revision = ?`,
  [after.status, after.attempts, after.revision, after.updatedAt, after.runId, after.id, before.revision]);
  if (result.rowCount !== 1) throw new Error('Tool call row changed while locked');
}

export async function recordAttempt(tx: SqlQueryable, scope: TrustedScope, before: ToolCallRecord, after: ToolCallRecord, lease?: LeaseToken) {
  if (after.status === 'dispatching') {
    await tx.query(`INSERT INTO viper_engine.tool_call_attempts (run_id, tool_call_id, attempt, actor_id, app_id, tenant_key,
      worker_id, lease_fence, dispatched_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [after.runId, after.id, after.attempts, ...ownerColumns(scope), lease?.workerId ?? null, lease?.fence ?? null, after.updatedAt]);
    return;
  }
  if (before.status !== 'dispatching' || !SETTLING.has(after.status)) return;
  const result = await tx.query(`UPDATE viper_engine.tool_call_attempts SET settled_at_ms = ?, result_kind = ?
    WHERE run_id = ? AND tool_call_id = ? AND attempt = ? AND settled_at_ms IS NULL`,
  [after.updatedAt, after.status, after.runId, after.id, before.attempts]);
  if (result.rowCount !== 1) throw new Error('Open tool call attempt is missing');
}
