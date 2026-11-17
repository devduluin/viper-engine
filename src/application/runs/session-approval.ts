import { applyApprovalTransition } from '../../contracts/state/transitions.js';
import { checkExpectedRevision } from '../../contracts/state/result.js';
import { resumeAgentCalls } from '../../agent/runtime/resume.js';
import { getApproval, assertProposalBinding } from './approval-snapshot.js';
import { refreshPending } from './session-policy.js';
import { activateSession, removePendingReports } from './session-lifecycle.js';
import type { ApprovalDecision, SessionState } from './session-state.js';
import { SessionError } from './session-state.js';

export function decideSessionApproval(state: SessionState, action: ApprovalDecision): void {
  if (state.result.status !== 'waiting_for_approval') throw new SessionError('invalid_state');
  if (action.decision !== 'accept' && action.decision !== 'reject') throw new SessionError('invalid_value');
  const approval = getApproval(state, action.approvalId);
  const stale = checkExpectedRevision(approval.revision, action.expectedRevision);
  if (stale !== undefined) throw new SessionError(stale.code);
  assertProposalBinding(approval.binding, action.binding);
  const next = applyApprovalTransition(approval, state.context.input.scope, {
    expectedRevision: action.expectedRevision, to: action.decision === 'accept' ? 'accepted' : 'rejected', at: state.deps.clock.now(),
  });
  if (!next.ok) throw new SessionError(next.error.code);
  state.approvals.set(approval.id, next.value);
}

export async function resumeSessionApproval(state: SessionState): Promise<void> {
  if (state.result.status !== 'waiting_for_approval') throw new SessionError('invalid_state');
  if (!await refreshPending(state)) return;
  const held = [...state.pending.values()];
  for (const item of held) {
    if (item.approvalId === undefined) continue;
    const approval = getApproval(state, item.approvalId);
    if (!['accepted', 'rejected'].includes(approval.status)) throw new SessionError('approval_required');
  }
  // Replace provisional reports, keeping every settled/unknown call's existing evidence.
  removePendingReports(state);
  await activateSession(state, () => resumeAgentCalls(state.context, held.map(item => item.call)));
}
