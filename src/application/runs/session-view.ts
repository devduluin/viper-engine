import type { ToolCall } from '../../contracts/messages/message.js';
import { mcpToolKey } from '../../contracts/mcp/identity.js';
import { newApproval } from './approval-snapshot.js';
import type { SessionAction, SessionState, SessionView } from './session-state.js';

/** Derive unanswered IDs from history, not from model prose or previous report counts. */
export function unansweredCalls(state: SessionState): readonly ToolCall[] {
  const pending = new Map<string, ToolCall>();
  for (const message of state.context.state.history) {
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) pending.set(call.id, call);
    if (message.role === 'tool') pending.delete(message.toolCallId);
  }
  return [...pending.values()];
}

export function capturePause(state: SessionState): void {
  if (state.result.status !== 'waiting_for_approval') return;
  for (const call of unansweredCalls(state)) {
    if (state.pending.get(call.id)?.approvalId !== undefined) continue;
    const tool = state.context.index.find(call.name);
    if (tool === undefined) throw new Error('Held call has no catalog binding');
    const report = [...state.context.state.reports].reverse().find(item => item.id === call.id);
    const approval = report?.status === 'awaiting_approval' ? newApproval(state, call) : undefined;
    state.pending.set(call.id, Object.freeze({ call, tool: tool.definition.ref,
      ...(approval === undefined ? {} : { approvalId: approval.id }),
    }));
  }
}

export function sessionView(state: SessionState): SessionView {
  const actions: SessionAction[] = [];
  if (state.result.status === 'waiting_for_input') actions.push(Object.freeze({
    kind: 'input_required', question: state.result.question ?? '',
  }));
  for (const held of state.pending.values()) {
    const current = state.context.index.find(held.call.name);
    if (held.approvalId === undefined && (current === undefined || mcpToolKey(current.definition.ref) !== mcpToolKey(held.tool))) {
      actions.push(Object.freeze({ kind: 'catalog_changed', toolCallId: held.call.id, name: held.call.name }));
    }
    const approval = held.approvalId === undefined ? undefined : state.approvals.get(held.approvalId);
    if (approval === undefined) continue;
    actions.push(Object.freeze({ kind: 'approval_required', approvalId: approval.id,
      revision: approval.revision, binding: approval.binding, arguments: held.call.arguments,
      status: approval.status, expiresAt: approval.expiresAt,
    }));
  }
  return Object.freeze({ ...state.result, revision: state.revision, actions: Object.freeze(actions) });
}
