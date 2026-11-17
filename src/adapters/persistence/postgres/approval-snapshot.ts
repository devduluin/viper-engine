import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import type { McpToolRef } from '../../../contracts/mcp/identity.js';
import { APPROVAL_ARGUMENTS_DIGEST } from '../../../contracts/state/approval-state.js';
import type { ApprovalId, ApprovalToolSnapshot, ArgumentsDigest } from '../../../contracts/state/approval-state.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import type { StateConflict } from '../../../contracts/state/result.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { APPROVAL_COLUMNS, approvalRecord, asRow, MS_PARAM, ownerColumns, toolSnapshotOf } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

/** The stored arguments must be exactly what the digest binds; otherwise the snapshot lies. */
export function snapshotConflict(args: JsonObject, snapshot: ApprovalToolSnapshot, digest: ArgumentsDigest): StateConflict | undefined {
  toolSnapshotOf(snapshot);
  return createFingerprint(args, APPROVAL_ARGUMENTS_DIGEST) === digest
    ? undefined : { code: 'approval_mismatch', message: 'Approval arguments do not match the bound digest' };
}

/**
 * Rechecked at proposal and at dispatch: the bound connection must still belong to the caller,
 * be ready (not revoked or awaiting re-authorization) and stay on the same server.
 */
export async function accessConflict(tx: SqlQueryable, scope: TrustedScope, tool: McpToolRef): Promise<StateConflict | undefined> {
  const result = await tx.query(`SELECT c.auth_state FROM viper_engine.mcp_connections c
    JOIN viper_engine.mcp_servers s ON s.id = c.server_id
    WHERE c.id = $1 AND c.server_id = $2 AND c.actor_id = $3 AND c.app_id = $4 AND c.tenant_key = $5
      AND s.enabled AND (s.owner_actor_id IS NULL OR s.owner_actor_id = c.actor_id) FOR SHARE OF c, s`,
  [tool.connectionId, tool.serverId, ...ownerColumns(scope)]);
  const state = result.rows[0] === undefined ? undefined : asRow(result.rows[0])['auth_state'];
  return state === 'ready' ? undefined : { code: 'access_revoked', message: 'The MCP connection for this approval is no longer usable' };
}

export interface ApprovalInsert {
  readonly id: ApprovalId;
  readonly call: ToolCallRecord;
  readonly arguments: JsonObject;
  readonly toolSnapshot: ApprovalToolSnapshot;
  readonly expiresAt: number;
  readonly at: number;
}

export async function insertApproval(tx: SqlQueryable, scope: TrustedScope, input: ApprovalInsert): Promise<ApprovalRecord> {
  const { call } = input;
  const result = await tx.query(`INSERT INTO viper_engine.approvals (id, actor_id, app_id, tenant_key, run_id, tool_call_id,
      connection_id, server_id, tool_name, definition_version, arguments_digest, status, expires_at, created_at, updated_at,
      arguments, tool_snapshot)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', ${MS_PARAM(12)}, ${MS_PARAM(13)}, ${MS_PARAM(13)}, $14, $15)
    RETURNING ${APPROVAL_COLUMNS}`, [input.id, ...ownerColumns(scope), call.runId, call.id, call.tool.connectionId,
    call.tool.serverId, call.tool.name, call.tool.definitionVersion, call.argumentsDigest, input.expiresAt, input.at,
    input.arguments, input.toolSnapshot]);
  return approvalRecord(result.rows[0]);
}

/** Status write with decision provenance: who decided, and which proposal superseded this one. */
export async function writeApproval(tx: SqlQueryable, scope: TrustedScope, before: ApprovalRecord, after: ApprovalRecord,
  supersededBy?: ApprovalId): Promise<void> {
  const decided = after.status === 'accepted' || after.status === 'rejected';
  const result = await tx.query(`UPDATE viper_engine.approvals SET status = $3, revision = $4, updated_at = ${MS_PARAM(5)},
      decided_at = CASE WHEN $6 THEN ${MS_PARAM(5)} ELSE decided_at END,
      decided_by = CASE WHEN $6 THEN $7 ELSE decided_by END,
      consumed_at = CASE WHEN $3 = 'consumed' THEN ${MS_PARAM(5)} ELSE consumed_at END,
      superseded_by = coalesce($8, superseded_by)
    WHERE id = $1 AND revision = $2`,
  [after.id, before.revision, after.status, after.revision, after.updatedAt, decided, scope.actorId, supersededBy ?? null]);
  if (result.rowCount !== 1) throw new Error('Approval row changed while locked');
}
