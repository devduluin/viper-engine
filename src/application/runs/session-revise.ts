import { parseToolCall, parseMessage } from '../../contracts/messages/parse-message.js';
import { parseMessageHistory } from '../../contracts/messages/history.js';
import { applyApprovalTransition } from '../../contracts/state/transitions.js';
import { checkExpectedRevision } from '../../contracts/state/result.js';
import { rejectionMessage } from '../../agent/execution/result-message.js';
import { appendRuntimeMessages } from '../../agent/runtime/run-loop.js';
import { getApproval, newApproval } from './approval-snapshot.js';
import { updatePausedSnapshot } from './session-lifecycle.js';
import type { ReviseProposal, SessionState } from './session-state.js';
import { SessionError } from './session-state.js';
import type { ApprovalRecord } from '../../contracts/state/records.js';

/** Supersedes the old immutable proposal; fresh args get fresh call and approval identities. */
export async function reviseSessionProposal(state: SessionState, action: ReviseProposal): Promise<void> {
  if (state.result.status !== 'waiting_for_approval') throw new SessionError('invalid_state');
  const old = getApproval(state, action.approvalId);
  const conflict = checkExpectedRevision(old.revision, action.expectedRevision);
  if (conflict !== undefined) throw new SessionError(conflict.code);
  const held = state.pending.get(old.binding.toolCallId);
  if (held === undefined || !['pending', 'accepted', 'expired', 'superseded'].includes(old.status)) throw new SessionError('invalid_state');
  const call = parseToolCall({ ...held.call, id: state.deps.ids.next('tool_call'), arguments: action.arguments });
  const tool = state.context.index.find(call.name);
  if (tool === undefined) throw new SessionError('not_found');
  if (!state.deps.validator.validate(tool.definition.inputSchema, call.arguments).ok) throw new SessionError('invalid_value');
  const closed = rejectionMessage(state.deps.ids.next('message'), held.call, { code: 'permission', message: 'Proposal superseded' });
  const proposed = parseMessage({ id: state.deps.ids.next('message'), role: 'assistant', content: [], toolCalls: [call] });
  parseMessageHistory([...state.context.state.history, closed, proposed]);
  state.context.budget.propose([call], state.context.index);
  supersedeApproval(state, old);
  const approval = newApproval(state, call);
  state.pending.delete(held.call.id);
  state.pending.set(call.id, Object.freeze({ call, tool: tool.definition.ref, approvalId: approval.id }));
  state.context.state.reports.splice(0, state.context.state.reports.length,
    ...state.context.state.reports.filter(report => report.id !== held.call.id),
    Object.freeze({ id: held.call.id, name: held.call.name, status: 'rejected' as const, failureCode: 'permission' as const }),
    Object.freeze({ id: call.id, name: call.name, status: 'awaiting_approval' as const, tool: tool.definition.ref }));
  try { await appendRuntimeMessages(state.context, [closed, proposed]); } catch (error) { state.poisoned = true; throw error; }
  updatePausedSnapshot(state);
}

function supersedeApproval(state: SessionState, old: ApprovalRecord): void {
  if (!['pending', 'accepted'].includes(old.status)) return;
  const next = applyApprovalTransition(old, state.context.input.scope, {
    expectedRevision: old.revision, to: 'superseded', at: state.deps.clock.now(),
  });
  if (!next.ok) throw new SessionError(next.error.code);
  state.approvals.set(old.id, next.value);
}
