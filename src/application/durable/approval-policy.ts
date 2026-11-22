import type { ToolCall } from '../../contracts/messages/message.js';
import { APPROVAL_ARGUMENTS_DIGEST, parseArgumentsDigest } from '../../contracts/state/approval-state.js';
import type { ToolCallRecord } from '../../contracts/state/records.js';
import { mcpToolKey } from '../../contracts/mcp/identity.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import type { RuntimeTool } from '../../agent/execution/tool-catalog.js';
import { userDeclined } from '../../contracts/state/tool-rejection.js';
import type { DurableSession } from './session.js';

export function digest(call: ToolCall) { return parseArgumentsDigest(createFingerprint(call.arguments, APPROVAL_ARGUMENTS_DIGEST)); }
export function approvalFor(session: DurableSession, call: ToolCall) {
  return session.checkpoint.approvals.find(approval => approval.binding.toolCallId === call.id
    && (approval.status === 'pending' || approval.status === 'accepted'));
}
function matchingRecord(session: DurableSession, tool: RuntimeTool, call: ToolCall): ToolCallRecord | undefined {
  const record = session.checkpoint.toolCalls.find(row => row.id === call.id);
  if (record === undefined || !['proposed', 'awaiting_approval', 'ready'].includes(record.status)) return undefined;
  if (mcpToolKey(record.tool) !== mcpToolKey(tool.definition.ref) || record.argumentsDigest !== digest(call)) return undefined;
  return record;
}
function declined(session: DurableSession, tool: RuntimeTool, call: ToolCall) {
  const candidate = { runId: session.claim.runId, toolCallId: call.id, tool: tool.definition.ref, argumentsDigest: digest(call) };
  for (const approval of session.checkpoint.approvals) {
    const reason = userDeclined(session.scope, approval, candidate); if (reason !== undefined) return reason;
  }
  return undefined;
}
export function policy(session: DurableSession, tool: RuntimeTool, call: ToolCall) {
  const decision = session.deps.policy.decide(tool, call); const record = matchingRecord(session, tool, call);
  if (decision === 'reject' || record === undefined || declined(session, tool, call) !== undefined) return 'reject';
  if (!record.requiresApproval && decision === 'execute') return 'execute';
  return approvalDecision(session, call);
}
export function policyRejection(session: DurableSession, tool: RuntimeTool, call: ToolCall) {
  if (session.deps.policy.decide(tool, call) === 'reject') return session.deps.policy.rejection?.(tool, call);
  const expired = session.checkpoint.approvals.some(approval => approval.binding.toolCallId === call.id
    && (approval.status === 'expired' || (['pending', 'accepted'].includes(approval.status) && approval.expiresAt <= session.deps.clock.now())));
  if (expired) return { code: 'permission' as const, message: 'Approval expired before execution. A new proposal requires fresh user approval.' };
  return matchingRecord(session, tool, call) === undefined ? undefined : declined(session, tool, call);
}
function approvalDecision(session: DurableSession, call: ToolCall) {
  const approval = approvalFor(session, call);
  if (approval !== undefined && approval.expiresAt <= session.deps.clock.now()) return 'reject';
  if (approval?.status === 'accepted') return 'execute';
  const previous = session.checkpoint.approvals.some(approval => approval.binding.toolCallId === call.id);
  return approval !== undefined || !previous ? 'requires_approval' : 'reject';
}
