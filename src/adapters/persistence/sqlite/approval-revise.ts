import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ApprovalRevision } from '../../../contracts/state/ports.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { applyApprovalTransition, applyToolCallTransition } from '../../../contracts/state/transitions.js';
import type { Revised } from '../postgres/approval-revise.js';
import { snapshotConflict } from '../postgres/approval-snapshot.js';
import { admissionConflict } from '../postgres/run-lock.js';
import type { LockedRun } from '../postgres/run-lock.js';
import { ownerColumns } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { accessConflict, insertApproval, writeApproval } from './approval-rows.js';
import { appendEvents } from './run-store.js';
import { callRecord, lockCall, writeCall } from './tool-call-rows.js';

const REVISABLE = new Set(['pending', 'accepted', 'expired']);

function preconditions(run: LockedRun, old: ApprovalRecord, revision: ApprovalRevision): StateConflict | undefined {
  return checkExpectedRevision(old.revision, revision.expectedRevision)
    ?? (REVISABLE.has(old.status) ? undefined : { code: 'invalid_transition', message: `A ${old.status} approval cannot be revised` })
    ?? admissionConflict(run.record)
    ?? (revision.expiresAt <= revision.at ? { code: 'approval_expired', message: 'Replacement approval has expired' } : undefined)
    ?? snapshotConflict(revision.arguments, old.toolSnapshot ?? { inputSchema: {} }, revision.argumentsDigest);
}

async function replacement(tx: SqlQueryable, scope: TrustedScope, call: ToolCallRecord, revision: ApprovalRevision) {
  const { tool } = call;
  const result = await tx.query(`INSERT INTO viper_engine.tool_calls (run_id, id, actor_id, app_id, tenant_key, step_id,
    status, connection_id, server_id, tool_name, definition_version, arguments_digest, requires_approval, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, 'awaiting_approval', ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`,
  [call.runId, revision.newToolCallId, ...ownerColumns(scope), call.stepId, tool.connectionId, tool.serverId,
    tool.name, tool.definitionVersion, revision.argumentsDigest, revision.at, revision.at]);
  return callRecord(result.rows[0]);
}

export async function reviseApproval(tx: SqlQueryable, scope: TrustedScope, run: LockedRun, old: ApprovalRecord,
  revision: ApprovalRevision): Promise<StateResult<Revised>> {
  const failure = preconditions(run, old, revision) ?? await accessConflict(tx, scope, old.binding.tool);
  if (failure !== undefined) return stateConflict(failure);
  const call = await lockCall(tx, old.binding.runId, old.binding.toolCallId);
  if (call === undefined || old.toolSnapshot === undefined) throw new Error('Approval call or tool snapshot is missing');
  const closed = applyToolCallTransition(call, scope, { to: call.status === 'ready' ? 'cancelled' : 'rejected', expectedRevision: call.revision, at: revision.at });
  if (!closed.ok) return stateConflict(closed.error);
  const next = old.status === 'expired' ? stateOk(old) : applyApprovalTransition(old, scope,
    { to: 'superseded', expectedRevision: old.revision, at: revision.at });
  if (!next.ok) return stateConflict(next.error);
  await writeCall(tx, call, closed.value);
  const toolCall = await replacement(tx, scope, call, revision);
  const approval = await insertApproval(tx, scope, { id: revision.newApprovalId, call: toolCall, arguments: revision.arguments,
    toolSnapshot: old.toolSnapshot, expiresAt: revision.expiresAt, at: revision.at });
  let superseded = old;
  if (next.value !== old) {
    superseded = Object.freeze({ ...next.value, supersededBy: approval.id });
    await writeApproval(tx, scope, old, superseded, approval.id);
  }
  await appendEvents(tx, run.record, scope, run.lastEventSequence, revision.events);
  return stateOk(Object.freeze({ superseded, approval, toolCall }));
}
