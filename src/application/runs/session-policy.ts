import { checkApprovalBinding } from '../../contracts/state/approval-state.js';
import { applyApprovalTransition, consumeApproval } from '../../contracts/state/transitions.js';
import { mcpToolKey } from '../../contracts/mcp/identity.js';
import { indexTools } from '../../agent/execution/tool-catalog.js';
import type { ToolCallPolicy } from '../../agent/execution/plan-call.js';
import type { CallRejection } from '../../agent/execution/plan-call.js';
import type { RuntimeTool } from '../../agent/execution/tool-catalog.js';
import type { ToolCall } from '../../contracts/messages/message.js';
import type { RuntimeEvent } from '../../agent/runtime/types.js';
import { proposalBinding } from './approval-snapshot.js';
import type { SessionDependencies, SessionState } from './session-state.js';
import { SessionError } from './session-state.js';
import type { ApprovalRecord } from '../../contracts/state/records.js';
import { userDeclined } from '../../contracts/state/tool-rejection.js';

export function sessionPolicy(state: SessionState): ToolCallPolicy {
  return { decide(tool, call) {
    const current = state.deps.policy.decide(tool, call);
    if (current === 'reject') return 'reject';
    const held = state.pending.get(call.id);
    const approval = held?.approvalId === undefined ? undefined : state.approvals.get(held.approvalId);
    if (approval === undefined) return current;
    if (approval.status === 'rejected') return 'reject';
    const same = checkApprovalBinding(approval.binding, proposalBinding(state, call)) === undefined;
    return same && approval.status === 'accepted' && state.deps.clock.now() < approval.expiresAt ? 'execute' : 'requires_approval';
  }, rejection: (tool, call) => sessionRejection(state, tool, call) };
}

function sessionRejection(state: SessionState, tool: RuntimeTool, call: ToolCall) {
  if (state.deps.policy.decide(tool, call) === 'reject') return state.deps.policy.rejection?.(tool, call);
  const held = state.pending.get(call.id);
  if (held?.approvalId === undefined || mcpToolKey(held.tool) !== mcpToolKey(tool.definition.ref)) return undefined;
  const approval = state.approvals.get(held.approvalId);
  return approval === undefined ? undefined : userDeclined(state.context.input.scope, approval, proposalBinding(state, call));
}

export function beforeSessionInvoke(state: SessionState, tool: RuntimeTool, call: ToolCall): CallRejection | undefined {
  const denied = state.deps.beforeToolInvoke?.(tool, call);
  if (denied !== undefined) return denied;
  const current = state.deps.policy.decide(tool, call);
  if (current === 'reject') return { code: 'permission', message: 'Access revoked before dispatch' };
  const held = state.pending.get(call.id);
  const approval = held?.approvalId === undefined ? undefined : state.approvals.get(held.approvalId);
  if (approval === undefined) return current === 'execute' ? undefined : { code: 'permission', message: 'Approval required before dispatch' };
  const matched = checkApprovalBinding(approval.binding, proposalBinding(state, call)) === undefined;
  if (!matched || approval.status !== 'consumed' || state.deps.clock.now() >= approval.expiresAt) {
    return { code: 'permission', message: 'Approval no longer permits this dispatch' };
  }
  return undefined;
}

export function beforeInitialInvoke(deps: SessionDependencies, tool: RuntimeTool, call: ToolCall): CallRejection | undefined {
  return deps.beforeToolInvoke?.(tool, call)
    ?? (deps.policy.decide(tool, call) === 'execute' ? undefined : { code: 'permission', message: 'Policy changed before dispatch' });
}

/** In-memory consumption only; P04 must combine it atomically with persisted dispatch intent. */
export async function emitSessionEvent(state: SessionState, event: RuntimeEvent): Promise<void> {
  if (event.type === 'tool_call_dispatching') {
    const held = state.pending.get(event.toolCallId);
    const approval = held?.approvalId === undefined ? undefined : state.approvals.get(held.approvalId);
    if (approval !== undefined && held !== undefined) {
      const consumed = consumeApproval(approval, state.context.input.scope, {
        expectedRevision: approval.revision, at: state.deps.clock.now(), binding: proposalBinding(state, held.call),
      });
      if (!consumed.ok) throw new SessionError(consumed.error.code);
      state.approvals.set(approval.id, consumed.value);
    }
  }
  await state.deps.onEvent?.(Object.freeze(event));
}

/** Returns false after invalidating a changed/expired proposal; never silently grants new tools. */
export async function refreshPending(state: SessionState): Promise<boolean> {
  const index = indexTools(await state.deps.refreshTools(state.context.input.scope), state.context.input.scope);
  let valid = true;
  state.context = { ...state.context, index };
  for (const held of state.pending.values()) {
    const tool = index.find(held.call.name);
    const changed = tool === undefined || mcpToolKey(tool.definition.ref) !== mcpToolKey(held.tool);
    const approval = held.approvalId === undefined ? undefined : state.approvals.get(held.approvalId);
    if (changed || approvalExpired(approval, state.deps.clock.now())) {
      valid = false;
      invalidateApproval(state, approval, changed);
    }
  }
  return valid;
}

function approvalExpired(approval: ApprovalRecord | undefined, now: number): boolean {
  return approval !== undefined && ['pending', 'accepted'].includes(approval.status) && now >= approval.expiresAt;
}

function invalidateApproval(state: SessionState, approval: ApprovalRecord | undefined, changed: boolean): void {
  if (approval === undefined || !['pending', 'accepted'].includes(approval.status)) return;
  const next = applyApprovalTransition(approval, state.context.input.scope, {
    expectedRevision: approval.revision, to: changed ? 'superseded' : 'expired', at: state.deps.clock.now(),
  });
  if (next.ok) state.approvals.set(approval.id, next.value);
}
