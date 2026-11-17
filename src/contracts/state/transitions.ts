import type { TrustedScope } from '../identity/scope.js';
import {
  checkApprovalBinding, checkApprovalTransition, isApprovalExpired,
} from './approval-state.js';
import type { ApprovalBinding, ApprovalStatus } from './approval-state.js';
import { checkOwnership } from './owner.js';
import type { ApprovalRecord, RunRecord, ToolCallRecord } from './records.js';
import { checkExpectedRevision, stateConflict, stateOk } from './result.js';
import type { StateConflict, StateResult } from './result.js';
import { checkRunSettlement, checkRunTransition, isTerminalRunStatus } from './run-state.js';
import type { RunStatus } from './run-state.js';
import { checkToolCallTransition } from './tool-call-state.js';
import type { ToolCallEvidence, ToolCallStatus } from './tool-call-state.js';

/**
 * Pure reference semantics for every RunStore/ToolCallLedger/ApprovalStore implementation.
 * Check order is fixed: ownership (as not_found), revision, transition, domain rules.
 * Stores apply the same rules atomically with the write and its durable events.
 */
interface TransitionBase {
  readonly expectedRevision: number;
  /** Epoch ms from the injected Clock. */
  readonly at: number;
}

export interface RunTransitionRequest extends TransitionBase {
  readonly to: RunStatus;
  /** Current statuses of every tool call of this run, read in the same transaction. */
  readonly toolCalls: readonly ToolCallStatus[];
}

export interface ToolCallTransitionRequest extends TransitionBase {
  readonly to: ToolCallStatus;
  readonly evidence?: ToolCallEvidence;
}

export interface ApprovalTransitionRequest extends TransitionBase {
  readonly to: Exclude<ApprovalStatus, 'pending' | 'consumed'>;
}

export interface ApprovalConsumeRequest extends TransitionBase {
  /** Binding of the call about to be dispatched, built from server-side state only. */
  readonly binding: ApprovalBinding;
}

function guarded<R extends { readonly revision: number }>(
  record: R,
  failure: StateConflict | undefined,
  changes: Partial<R> & { readonly updatedAt: number },
): StateResult<R> {
  if (failure !== undefined) return stateConflict(failure);
  if (!Number.isSafeInteger(record.revision + 1)) throw new RangeError('Revision exceeds the safe integer range');
  return stateOk(Object.freeze({ ...record, ...changes, revision: record.revision + 1 }));
}

export function applyRunTransition(record: RunRecord, scope: TrustedScope, request: RunTransitionRequest): StateResult<RunRecord> {
  const failure = checkOwnership(record.owner, scope)
    ?? checkExpectedRevision(record.revision, request.expectedRevision)
    ?? checkRunTransition(record.status, request.to)
    ?? checkRunSettlement(request.to, request.toolCalls);
  return guarded(record, failure, { status: request.to, updatedAt: request.at });
}

/**
 * Idempotent cancellation intent; needs no expected revision because cancel always wins.
 * Terminal or already-requested runs are returned unchanged without a new revision.
 */
export function requestRunCancellation(record: RunRecord, scope: TrustedScope, at: number): StateResult<RunRecord> {
  const failure = checkOwnership(record.owner, scope);
  if (failure !== undefined) return stateConflict(failure);
  if (isTerminalRunStatus(record.status) || record.cancelRequestedAt !== undefined) return stateOk(record);
  return guarded(record, undefined, { cancelRequestedAt: at, updatedAt: at });
}

function checkApprovalGate(record: ToolCallRecord, to: ToolCallStatus): StateConflict | undefined {
  if (record.requiresApproval && record.status === 'proposed' && to === 'ready') {
    return { code: 'invalid_transition', message: 'Tool call requires approval before it is ready' };
  }
  return undefined;
}

export function applyToolCallTransition(
  record: ToolCallRecord,
  scope: TrustedScope,
  request: ToolCallTransitionRequest,
): StateResult<ToolCallRecord> {
  const failure = checkOwnership(record.owner, scope)
    ?? checkExpectedRevision(record.revision, request.expectedRevision)
    ?? checkToolCallTransition(record.status, request.to, request.evidence)
    ?? checkApprovalGate(record, request.to);
  const attempts = record.attempts + (request.to === 'dispatching' ? 1 : 0);
  return guarded(record, failure, { status: request.to, attempts, updatedAt: request.at });
}

function checkAcceptance(record: ApprovalRecord, to: ApprovalStatus, at: number): StateConflict | undefined {
  if (to !== 'accepted' || !isApprovalExpired(record.expiresAt, at)) return undefined;
  return { code: 'approval_expired', message: 'Approval proposal has expired' };
}

export function applyApprovalTransition(
  record: ApprovalRecord,
  scope: TrustedScope,
  request: ApprovalTransitionRequest,
): StateResult<ApprovalRecord> {
  const failure = checkOwnership(record.owner, scope)
    ?? checkExpectedRevision(record.revision, request.expectedRevision)
    ?? checkApprovalTransition(record.status, request.to)
    ?? checkAcceptance(record, request.to, request.at);
  return guarded(record, failure, { status: request.to, updatedAt: request.at });
}

function checkConsumable(record: ApprovalRecord, at: number): StateConflict | undefined {
  if (!isApprovalExpired(record.expiresAt, at)) return undefined;
  return { code: 'approval_expired', message: 'Accepted approval expired before dispatch' };
}

/** Single-use consumption; the store commits it with the tool call's dispatch intent. */
export function consumeApproval(
  record: ApprovalRecord,
  scope: TrustedScope,
  request: ApprovalConsumeRequest,
): StateResult<ApprovalRecord> {
  const failure = checkOwnership(record.owner, scope)
    ?? checkExpectedRevision(record.revision, request.expectedRevision)
    ?? checkApprovalTransition(record.status, 'consumed')
    ?? checkConsumable(record, request.at)
    ?? checkApprovalBinding(record.binding, request.binding);
  return guarded(record, failure, { status: 'consumed', updatedAt: request.at });
}
