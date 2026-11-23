import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { McpToolRef } from '../../../contracts/mcp/identity.js';
import type { ApprovalBinding, ApprovalId } from '../../../contracts/state/approval-state.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import type { StateConflict } from '../../../contracts/state/result.js';
import type { ApprovalInsert } from '../postgres/approval-snapshot.js';
import { approvalRecord, asRow, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';

export function decodeApproval(value: unknown): ApprovalRecord {
  const row = asRow(value);
  return approvalRecord({ ...row, arguments: JSON.parse(text(row, 'arguments')),
    tool_snapshot: JSON.parse(text(row, 'tool_snapshot')) });
}

export function bindingOf(call: ToolCallRecord): ApprovalBinding {
  return { runId: call.runId, toolCallId: call.id, tool: call.tool, argumentsDigest: call.argumentsDigest };
}

export async function accessConflict(tx: SqlQueryable, scope: TrustedScope, tool: McpToolRef): Promise<StateConflict | undefined> {
  const result = await tx.query(`SELECT c.auth_state FROM viper_engine.mcp_connections c
    JOIN viper_engine.mcp_servers s ON s.id = c.server_id
    WHERE c.id = ? AND c.server_id = ? AND c.actor_id = ? AND c.app_id = ? AND c.tenant_key = ?
      AND s.enabled = 1 AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id)`,
  [tool.connectionId, tool.serverId, ...ownerColumns(scope)]);
  return result.rows[0] !== undefined && asRow(result.rows[0])['auth_state'] === 'ready' ? undefined
    : { code: 'access_revoked', message: 'The MCP connection for this approval is no longer usable' };
}

export async function insertApproval(tx: SqlQueryable, scope: TrustedScope, data: ApprovalInsert): Promise<ApprovalRecord> {
  const { call } = data;
  const result = await tx.query(`INSERT INTO viper_engine.approvals (id, actor_id, app_id, tenant_key, run_id, tool_call_id,
    connection_id, server_id, tool_name, definition_version, arguments_digest, status, expires_at_ms, created_at_ms,
    updated_at_ms, arguments, tool_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?) RETURNING *`,
  [data.id, ...ownerColumns(scope), call.runId, call.id, call.tool.connectionId, call.tool.serverId, call.tool.name,
    call.tool.definitionVersion, call.argumentsDigest, data.expiresAt, data.at, data.at,
    JSON.stringify(data.arguments), JSON.stringify(data.toolSnapshot)]);
  return decodeApproval(result.rows[0]);
}

export async function writeApproval(tx: SqlQueryable, scope: TrustedScope, before: ApprovalRecord, after: ApprovalRecord, supersededBy?: ApprovalId) {
  const decided = after.status === 'accepted' || after.status === 'rejected';
  const consumed = after.status === 'consumed';
  const result = await tx.query(`UPDATE viper_engine.approvals SET status = ?, revision = ?, updated_at_ms = ?,
    decided_at_ms = coalesce(?, decided_at_ms), decided_by = coalesce(?, decided_by),
    consumed_at_ms = coalesce(?, consumed_at_ms), superseded_by = coalesce(?, superseded_by)
    WHERE id = ? AND revision = ?`,
  [after.status, after.revision, after.updatedAt, decided ? after.updatedAt : null, decided ? scope.actorId : null,
    consumed ? after.updatedAt : null, supersededBy ?? null, after.id, before.revision]);
  if (result.rowCount !== 1) throw new Error('Approval row changed while locked');
}
