import { parseId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ApprovalId } from '../../../contracts/state/approval-state.js';
import { checkApprovalBinding } from '../../../contracts/state/approval-state.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { ApprovalStore } from '../../../contracts/state/ports.js';
import type { ApprovalRecord, ToolCallRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { applyApprovalTransition, applyToolCallTransition, consumeApproval } from '../../../contracts/state/transitions.js';
import { snapshotProposal, snapshotRevision } from '../postgres/approval-input.js';
import { snapshotConflict } from '../postgres/approval-snapshot.js';
import { admissionConflict, leaseConflict, NOT_FOUND } from '../postgres/run-lock.js';
import type { LockedRun } from '../postgres/run-lock.js';
import { asRow } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { accessConflict, bindingOf, decodeApproval, insertApproval, writeApproval } from './approval-rows.js';
import { reviseApproval } from './approval-revise.js';
import { appendEvents, lockRun } from './run-store.js';
import { lockCall, recordAttempt, writeCall } from './tool-call-rows.js';

type Locked = { readonly run: LockedRun; readonly approval: ApprovalRecord };
type Consumed = { readonly approval: ApprovalRecord; readonly toolCall: ToolCallRecord };
type Proposal = Parameters<ApprovalStore['propose']>[1];

function proposalConflict(run: LockedRun, call: ToolCallRecord, proposal: Proposal) {
  return admissionConflict(run.record) ?? checkApprovalBinding(bindingOf(call), proposal.binding)
    ?? snapshotConflict(proposal.arguments, proposal.toolSnapshot, proposal.binding.argumentsDigest);
}

export class SqliteApprovalStore implements ApprovalStore {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now) {}

  async propose(scope: TrustedScope, input: Proposal): Promise<StateResult<ApprovalRecord>> {
    const proposal = snapshotProposal(input);
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, proposal.binding.runId, this.clock);
      if (!run.ok) return stateConflict(run.error);
      const lost = leaseConflict(run.value, proposal.lease, proposal.at);
      if (lost !== undefined) return stateConflict(lost);
      const at = Math.max(proposal.at, run.value.leaseCheckedAt ?? proposal.at);
      if (proposal.expiresAt <= at) return stateConflict({ code: 'approval_expired', message: 'Approval proposal has expired' });
      const call = await lockCall(tx, proposal.binding.runId, proposal.binding.toolCallId);
      if (call === undefined) return stateConflict(NOT_FOUND);
      const failure = proposalConflict(run.value, call, proposal) ?? await accessConflict(tx, scope, call.tool);
      if (failure !== undefined) return stateConflict(failure);
      const live = await tx.query(`SELECT id FROM viper_engine.approvals
        WHERE run_id = ? AND tool_call_id = ? AND status IN ('pending','accepted')`, [call.runId, call.id]);
      if (live.rows.length > 0) return stateConflict({ code: 'invalid_transition', message: 'A live approval already exists for this tool call' });
      const approval = await insertApproval(tx, scope, { ...proposal, at, call });
      await appendEvents(tx, run.value.record, scope, run.value.lastEventSequence, proposal.events);
      return stateOk(approval);
    });
  }

  async get(scope: TrustedScope, id: ApprovalId): Promise<StateResult<ApprovalRecord>> {
    const result = await this.pool.query('SELECT * FROM viper_engine.approvals WHERE id = ?', [id]);
    if (result.rows[0] === undefined) return stateConflict(NOT_FOUND);
    const record = decodeApproval(result.rows[0]);
    const failure = checkOwnership(record.owner, scope);
    return failure === undefined ? stateOk(record) : stateConflict(failure);
  }

  async decide(scope: TrustedScope, id: ApprovalId, request: Parameters<ApprovalStore['decide']>[2]): Promise<StateResult<ApprovalRecord>> {
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict(locked.error);
      const { run, approval } = locked.value;
      const at = Math.max(request.at, run.leaseCheckedAt ?? request.at);
      const next = applyApprovalTransition(approval, scope, { ...request, at });
      if (!next.ok) return next;
      await writeApproval(tx, scope, approval, next.value);
      await appendEvents(tx, run.record, scope, run.lastEventSequence, request.events);
      return next;
    });
  }

  async consumeForDispatch(scope: TrustedScope, id: ApprovalId, request: Parameters<ApprovalStore['consumeForDispatch']>[2]): Promise<StateResult<Consumed>> {
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict(locked.error);
      const { run, approval } = locked.value;
      const at = Math.max(request.at, run.leaseCheckedAt ?? request.at);
      const lost = leaseConflict(run, request.lease, at);
      if (lost !== undefined) return stateConflict(lost);
      const consumed = consumeApproval(approval, scope, { ...request, at });
      if (!consumed.ok) return stateConflict(consumed.error);
      const closed = admissionConflict(run.record) ?? await accessConflict(tx, scope, approval.binding.tool);
      if (closed !== undefined) return stateConflict(closed);
      const call = await lockCall(tx, approval.binding.runId, approval.binding.toolCallId);
      if (call === undefined) throw new Error('Approved tool call is missing');
      const next = applyToolCallTransition(call, scope, { to: 'dispatching', expectedRevision: request.toolCallExpectedRevision, at });
      if (!next.ok) return stateConflict(next.error);
      await writeApproval(tx, scope, approval, consumed.value);
      await writeCall(tx, call, next.value);
      await recordAttempt(tx, scope, call, next.value, request.lease);
      await appendEvents(tx, run.record, scope, run.lastEventSequence, request.events);
      return stateOk(Object.freeze({ approval: consumed.value, toolCall: next.value }));
    });
  }

  async revise(scope: TrustedScope, id: ApprovalId, revision: Parameters<ApprovalStore['revise']>[2]): ReturnType<ApprovalStore['revise']> {
    const input = snapshotRevision(revision);
    return withTransaction(this.pool, async tx => {
      const locked = await this.lock(tx, scope, id);
      if (!locked.ok) return stateConflict(locked.error);
      const { run, approval } = locked.value;
      return reviseApproval(tx, scope, run, approval, { ...input, at: Math.max(input.at, run.leaseCheckedAt ?? input.at) });
    });
  }

  async expireDue(at: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid expiry batch size');
    const result = await this.pool.query(`UPDATE viper_engine.approvals SET status = 'expired', revision = revision + 1, updated_at_ms = ?
      WHERE id IN (SELECT id FROM viper_engine.approvals WHERE status IN ('pending','accepted') AND expires_at_ms <= ?
        ORDER BY expires_at_ms, id LIMIT ?)`, [at, at, limit]);
    return result.rowCount ?? 0;
  }

  private async lock(tx: SqlQueryable, scope: TrustedScope, id: ApprovalId): Promise<StateResult<Locked>> {
    const found = (await tx.query('SELECT * FROM viper_engine.approvals WHERE id = ?', [id])).rows[0];
    if (found === undefined) return stateConflict(NOT_FOUND);
    const run = await lockRun(tx, scope, parseId('run', asRow(found)['run_id']), this.clock);
    if (!run.ok) return stateConflict(run.error);
    const approval = decodeApproval(found);
    const failure = checkOwnership(approval.owner, scope);
    return failure === undefined ? stateOk({ run: run.value, approval }) : stateConflict(failure);
  }
}
