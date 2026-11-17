import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest, checkApprovalBinding } from '../../contracts/state/approval-state.js';
import type { ApprovalBinding, ApprovalId } from '../../contracts/state/approval-state.js';
import type { ApprovalRecord } from '../../contracts/state/records.js';
import { ownerFromScope } from '../../contracts/state/owner.js';
import type { ToolCall } from '../../contracts/messages/message.js';
import type { SessionState } from './session-state.js';
import { SessionError } from './session-state.js';

export function proposalBinding(state: SessionState, call: ToolCall): ApprovalBinding {
  const tool = state.context.index.find(call.name);
  if (tool === undefined) throw new SessionError('not_found');
  return Object.freeze({ runId: state.context.input.runId, toolCallId: call.id, tool: tool.definition.ref,
    argumentsDigest: parseArgumentsDigest(createFingerprint(call.arguments, APPROVAL_ARGUMENTS_DIGEST)),
  });
}

export function newApproval(state: SessionState, call: ToolCall): ApprovalRecord {
  const at = state.deps.clock.now();
  const expiresAt = at + state.approvalTtlMs;
  if (!Number.isSafeInteger(expiresAt)) throw new RangeError('Approval expiry exceeds safe time range');
  const record: ApprovalRecord = Object.freeze({
    id: state.deps.ids.next('approval'), owner: ownerFromScope(state.context.input.scope),
    binding: proposalBinding(state, call), status: 'pending', revision: 1,
    createdAt: at, updatedAt: at, expiresAt,
  });
  if (state.approvals.has(record.id)) throw new Error('Duplicate approval identifier');
  state.approvals.set(record.id, record);
  return record;
}

export function getApproval(state: SessionState, id: ApprovalId): ApprovalRecord {
  const approval = state.approvals.get(id);
  if (approval === undefined) throw new SessionError('not_found');
  return approval;
}

export function assertProposalBinding(approved: ApprovalBinding, candidate: ApprovalBinding): void {
  const conflict = checkApprovalBinding(approved, candidate);
  if (conflict !== undefined) throw new SessionError(conflict.code, conflict.message);
}
