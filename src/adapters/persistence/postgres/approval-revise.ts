import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ApprovalRevision } from '../../../contracts/state/ports.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { applyApprovalTransition, applyToolCallTransition } from '../../../contracts/state/transitions.js';
import { accessConflict, insertApproval, snapshotConflict, writeApproval } from './approval-snapshot.js';
import type { LockedRun } from './run-lock.js';
import { admissionConflict, appendEvents } from './run-lock.js';
import { MS_PARAM, ownerColumns, TOOL_CALL_COLUMNS, toolCallRecord } from './rows.js';
import type { SqlQueryable } from './sql-client.js';
import { lockToolCall, writeToolCall } from './tool-call-ledger.js';

export type Revised = { readonly superseded: ApprovalRecord; readonly approval: ApprovalRecord; readonly toolCall: ToolCallRecord };

const REVISABLE: ReadonlySet<string> = new Set(['pending', 'accepted', 'expired']);

function preconditions(run: LockedRun, old: ApprovalRecord, revision: ApprovalRevision): StateConflict | undefined {
  return checkExpectedRevision(old.revision, revision.expectedRevision)
    ?? (REVISABLE.has(old.status) ? undefined : { code: 'invalid_transition', message: `A ${old.status} approval cannot be revised` })
    ?? admissionConflict(run.record)
    ?? (revision.expiresAt <= revision.at ? { code: 'approval_expired', message: 'Replacement approval has expired' } : undefined)
    ?? snapshotConflict(revision.arguments, old.toolSnapshot ?? { inputSchema: {} }, revision.argumentsDigest);
}

/** The superseded call never dispatches: it is rejected (or cancelled once it became ready). */
async function closeOldCall(tx: SqlQueryable, scope: TrustedScope, call: ToolCallRecord, at: number): Promise<StateConflict | undefined> {
  const closed = applyToolCallTransition(call, scope, { to: call.status === 'ready' ? 'cancelled' : 'rejected', expectedRevision: call.revision, at });
  if (!closed.ok) return closed.error;
  await writeToolCall(tx, call, closed.value);
  return undefined;
}

async function insertCall(tx: SqlQueryable, scope: TrustedScope, old: ToolCallRecord, schema: unknown, revision: ApprovalRevision): Promise<ToolCallRecord> {
  const { tool } = old;
  const result = await tx.query(`INSERT INTO viper_engine.tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id, status,
      connection_id, server_id, tool_name, definition_version, schema_snapshot, arguments, arguments_digest, requires_approval,
      created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'awaiting_approval', $7, $8, $9, $10, $11, $12, $13, true, ${MS_PARAM(14)}, ${MS_PARAM(14)})
    RETURNING ${TOOL_CALL_COLUMNS}`, [old.runId, revision.newToolCallId, ...ownerColumns(scope), old.stepId, tool.connectionId,
    tool.serverId, tool.name, tool.definitionVersion, schema ?? null, revision.arguments, revision.argumentsDigest, revision.at]);
  return toolCallRecord(result.rows[0]);
}

/**
 * Parameter amendment in one transaction: checks, close the old call, insert the amended call and
 * its pending approval (same tool, same definition version, same snapshot), then supersede.
 */
export async function reviseApproval(
  tx: SqlQueryable, scope: TrustedScope, run: LockedRun, old: ApprovalRecord, revision: ApprovalRevision,
): Promise<StateResult<Revised>> {
  const call = await lockToolCall(tx, old.binding.runId, old.binding.toolCallId);
  if (call === undefined) throw new Error('Approved tool call is missing');
  const failure = preconditions(run, old, revision) ?? await accessConflict(tx, scope, old.binding.tool)
    ?? await closeOldCall(tx, scope, call, revision.at);
  if (failure !== undefined) return stateConflict(failure);
  const toolCall = await insertCall(tx, scope, call, old.toolSnapshot?.inputSchema, revision);
  const approval = await insertApprovalFor(tx, scope, old, toolCall, revision);
  let superseded = old;
  if (old.status !== 'expired') {
    const next = applyApprovalTransition(old, scope, { to: 'superseded', expectedRevision: old.revision, at: revision.at });
    if (!next.ok) return stateConflict(next.error);
    await writeApproval(tx, scope, old, next.value, approval.id);
    superseded = Object.freeze({ ...next.value, supersededBy: approval.id });
  }
  await appendEvents(tx, scope, run, revision.events);
  return stateOk(Object.freeze({ superseded, approval, toolCall }));
}

function insertApprovalFor(tx: SqlQueryable, scope: TrustedScope, old: ApprovalRecord, call: ToolCallRecord, revision: ApprovalRevision) {
  if (old.toolSnapshot === undefined) throw new Error('Approval has no stored tool snapshot');
  return insertApproval(tx, scope, {
    id: revision.newApprovalId, call, arguments: revision.arguments, toolSnapshot: old.toolSnapshot,
    expiresAt: revision.expiresAt, at: revision.at,
  });
}
