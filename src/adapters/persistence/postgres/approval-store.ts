import { parseId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ApprovalBinding, ApprovalId } from '../../../contracts/state/approval-state.js';
import { checkApprovalBinding } from '../../../contracts/state/approval-state.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { ApprovalProposal, ApprovalRevision, ApprovalStore } from '../../../contracts/state/ports.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { applyApprovalTransition, applyToolCallTransition, consumeApproval } from '../../../contracts/state/transitions.js';
import type { ApprovalConsumeRequest, ApprovalTransitionRequest } from '../../../contracts/state/transitions.js';
import { reviseApproval } from './approval-revise.js';
import type { Revised } from './approval-revise.js';
import { accessConflict, insertApproval, snapshotConflict, writeApproval } from './approval-snapshot.js';
import { recordAttempt } from './attempts.js';
import { snapshotProposal, snapshotRevision } from './approval-input.js';
import { admissionConflict, appendEvents, leaseConflict, lockRun, NOT_FOUND } from './run-lock.js';
import type { LockedRun } from './run-lock.js';
import { APPROVAL_COLUMNS, approvalRecord, asRow, MS_PARAM } from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { sqlConstraint, sqlState, SQLSTATE, withTransaction } from './sql-client.js';
import { lockToolCall, writeToolCall } from './tool-call-ledger.js';

type Events = { readonly events: readonly NewRunEvent[] };
type ConsumeInput = ApprovalConsumeRequest & { readonly toolCallExpectedRevision: number; readonly lease?: LeaseToken } & Events;
type Locked = { readonly run: LockedRun; readonly approval: ApprovalRecord };

const LIVE_EXISTS = Object.freeze({ code: 'invalid_transition', message: 'A live approval already exists for this tool call' } as const);

function bindingOf(call: ToolCallRecord): ApprovalBinding {
  return { runId: call.runId, toolCallId: call.id, tool: call.tool, argumentsDigest: call.argumentsDigest };
}

export class PostgresApprovalStore implements ApprovalStore {
  constructor(private readonly pool: SqlPool) {}

  /**
   * The binding must equal the current tool call exactly, the stored arguments must hash to its
   * digest, and the connection must still be usable. One live approval per call.
   */
  async propose(scope: TrustedScope, input: ApprovalProposal): Promise<StateResult<ApprovalRecord>> {
    input = snapshotProposal(input);
    try {
      return await withTransaction(this.pool, async tx => {
        const run = await lockRun(tx, scope, input.binding.runId);
        if (!run.ok) return stateConflict(run.error);
        const lost = leaseConflict(run.value, input.lease, input.at);
        if (lost !== undefined) return stateConflict(lost);
        const at = Math.max(input.at, run.value.leaseCheckedAt ?? input.at);
        if (input.expiresAt <= at) return stateConflict({ code: 'approval_expired', message: 'Approval proposal has expired' });
        const call = await lockToolCall(tx, input.binding.runId, input.binding.toolCallId);
        if (call === undefined) return stateConflict(NOT_FOUND);
        const failure = admissionConflict(run.value.record) ?? checkApprovalBinding(bindingOf(call), input.binding)
          ?? snapshotConflict(input.arguments, input.toolSnapshot, input.binding.argumentsDigest)
          ?? await accessConflict(tx, scope, call.tool);
        if (failure !== undefined) return stateConflict(failure);
        const approval = await insertApproval(tx, scope, { ...input, at, call });
        await appendEvents(tx, scope, run.value, input.events);
        return stateOk(approval);
      });
    } catch (error) {
      // Only the one-live-approval index is a domain conflict; duplicate IDs/events are faults.
      if (sqlState(error) === SQLSTATE.uniqueViolation && sqlConstraint(error) === 'approvals_one_live') {
        return stateConflict(LIVE_EXISTS);
      }
      throw error;
    }
  }

  async get(scope: TrustedScope, id: ApprovalId): Promise<StateResult<ApprovalRecord>> {
    const result = await this.pool.query(`SELECT ${APPROVAL_COLUMNS} FROM viper_engine.approvals WHERE id = $1`, [id]);
    if (result.rows[0] === undefined) return stateConflict(NOT_FOUND);
    const record = approvalRecord(result.rows[0]);
    const failure = checkOwnership(record.owner, scope);
    return failure === undefined ? stateOk(record) : stateConflict(failure);
  }

  async decide(scope: TrustedScope, id: ApprovalId, request: ApprovalTransitionRequest & Events): Promise<StateResult<ApprovalRecord>> {
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict(locked.error);
      const at = Math.max(request.at, locked.value.run.leaseCheckedAt ?? request.at);
      const next = applyApprovalTransition(locked.value.approval, scope, { ...request, at });
      if (!next.ok) return next;
      await writeApproval(tx, scope, locked.value.approval, next.value);
      await appendEvents(tx, scope, locked.value.run, request.events);
      return next;
    });
  }

  /** Approval consumption and the call's move to dispatching commit together or not at all. */
  async consumeForDispatch(scope: TrustedScope, id: ApprovalId, request: ConsumeInput) {
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict<{ approval: ApprovalRecord; toolCall: ToolCallRecord }>(locked.error);
      const { approval, run } = locked.value;
      request = { ...request, at: Math.max(request.at, run.leaseCheckedAt ?? request.at) };
      const lost = leaseConflict(run, request.lease, request.at);
      if (lost !== undefined) return stateConflict<{ approval: ApprovalRecord; toolCall: ToolCallRecord }>(lost);
      const consumed = consumeApproval(approval, scope, request);
      if (!consumed.ok) return stateConflict<{ approval: ApprovalRecord; toolCall: ToolCallRecord }>(consumed.error);
      const closed = admissionConflict(run.record) ?? await accessConflict(tx, scope, approval.binding.tool);
      if (closed !== undefined) return stateConflict<{ approval: ApprovalRecord; toolCall: ToolCallRecord }>(closed);
      const call = await lockToolCall(tx, approval.binding.runId, approval.binding.toolCallId);
      if (call === undefined) throw new Error('Approved tool call is missing');
      const dispatching = applyToolCallTransition(call, scope, {
        to: 'dispatching', expectedRevision: request.toolCallExpectedRevision, at: request.at,
      });
      if (!dispatching.ok) return stateConflict<{ approval: ApprovalRecord; toolCall: ToolCallRecord }>(dispatching.error);
      await writeApproval(tx, scope, approval, consumed.value);
      await writeToolCall(tx, call, dispatching.value);
      await recordAttempt(tx, scope, call, dispatching.value, request.lease);
      await appendEvents(tx, scope, run, request.events);
      return stateOk(Object.freeze({ approval: consumed.value, toolCall: dispatching.value }));
    });
  }

  async revise(scope: TrustedScope, id: ApprovalId, revision: ApprovalRevision): Promise<StateResult<Revised>> {
    revision = snapshotRevision(revision);
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict<Revised>(locked.error);
      const at = Math.max(revision.at, locked.value.run.leaseCheckedAt ?? revision.at);
      return reviseApproval(tx, scope, locked.value.run, locked.value.approval, { ...revision, at });
    });
  }

  /** Expires due proposals; SKIP LOCKED so it never waits behind a decision in progress. */
  async expireDue(at: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError('Invalid expiry batch size');
    const result = await this.pool.query(`UPDATE viper_engine.approvals SET status = 'expired', revision = revision + 1,
        updated_at = ${MS_PARAM(1)}
      WHERE id IN (SELECT id FROM viper_engine.approvals WHERE status IN ('pending', 'accepted') AND expires_at <= ${MS_PARAM(1)}
        ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)`, [at, limit]);
    return result.rowCount ?? 0;
  }

  /** Lock order run -> approval (-> tool call), owner checked before anything is revealed. */
  private async lock(tx: SqlQueryable, scope: TrustedScope, id: ApprovalId): Promise<StateResult<Locked>> {
    const found = await tx.query('SELECT run_id FROM viper_engine.approvals WHERE id = $1', [id]);
    if (found.rows[0] === undefined) return stateConflict(NOT_FOUND);
    const run = await lockRun(tx, scope, parseId('run', asRow(found.rows[0])['run_id']));
    if (!run.ok) return stateConflict(run.error);
    const result = await tx.query(`SELECT ${APPROVAL_COLUMNS} FROM viper_engine.approvals WHERE id = $1 FOR UPDATE`, [id]);
    const approval = approvalRecord(result.rows[0]);
    const failure = checkOwnership(approval.owner, scope);
    return failure === undefined ? stateOk({ run: run.value, approval }) : stateConflict(failure);
  }
}
