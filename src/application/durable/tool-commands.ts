import type { ToolCall } from '../../contracts/messages/message.js';
import type { JournalCommand } from '../../contracts/state/journal.js';
import type { ToolCallRecord } from '../../contracts/state/records.js';
import type { RuntimeTool } from '../../agent/execution/tool-catalog.js';
import type { ToolCallReport } from '../../agent/execution/dispatch.js';
import type { DurableSession } from './session.js';
import { digest, approvalFor, policy } from './approval-policy.js';
import { parseApprovalTtl } from '../runs/approval-ttl.js';

function requiresApproval(session: DurableSession, row: ToolCallRecord, tool: RuntimeTool, call: ToolCall): boolean {
  return row.requiresApproval || session.deps.policy.decide(tool, call) === 'requires_approval';
}

export function proposals(session: DurableSession, calls: readonly ToolCall[]): JournalCommand[] {
  return calls.flatMap(call => {
    const tool = session.context?.index.find(call.name);
    if (tool === undefined || session.state.stepId === undefined) return [];
    return [{ kind: 'tool_proposal' as const, input: { id: call.id, runId: session.claim.runId,
      stepId: session.state.stepId, tool: tool.definition.ref, argumentsDigest: digest(call),
      requiresApproval: session.deps.policy.decide(tool, call) === 'requires_approval', at: session.deps.clock.now() } }];
  });
}

export function transition(row: ToolCallRecord, to: ToolCallRecord['status'], at: number, revision = row.revision): JournalCommand {
  return { kind: 'tool_transition', id: row.id, input: { to, at, expectedRevision: revision, events: [] } };
}

export function dispatchCommands(session: DurableSession, id: string): JournalCommand[] {
  const row = session.checkpoint.toolCalls.find(row => row.id === id);
  if (row === undefined || !['proposed', 'awaiting_approval', 'ready'].includes(row.status)) throw new Error('Call is not dispatchable');
  const call = session.call(id);
  const tool = session.context?.index.find(call.name);
  if (tool === undefined || policy(session, tool, call) !== 'execute') throw new Error('Dispatch no longer permitted');
  const at = session.deps.clock.now();
  const commands = row.status === 'ready' ? [] : [transition(row, 'ready', at)];
  const revision = row.revision + commands.length;
  const events = [{ ...session.event('tool.started', { attempt: row.attempts + 1 }), stepId: row.stepId, toolCallId: row.id }];
  if (requiresApproval(session, row, tool, call)) {
    const approval = approvalFor(session, call);
    if (approval?.status !== 'accepted') throw new Error('Approval is not accepted');
    commands.push({ kind: 'approval_consume', id: approval.id, input: { at, binding: approval.binding,
      expectedRevision: approval.revision, toolCallExpectedRevision: revision, events } });
  } else commands.push({ kind: 'tool_transition', id: row.id, input: { to: 'dispatching', at, expectedRevision: revision, events } });
  return commands;
}

export function reportCommands(session: DurableSession, report: ToolCallReport): JournalCommand[] {
  const row = session.checkpoint.toolCalls.find(row => row.id === report.id);
  if (row === undefined || report.status === 'deferred') return [];
  if (['succeeded', 'failed', 'unknown', 'rejected', 'cancelled'].includes(row.status)) return [];
  const at = session.deps.clock.now();
  if (report.status === 'awaiting_approval') return approvalCommands(session, row, at);
  if (row.status === 'dispatching' && report.dispatchState === 'not_sent') return [
    { kind: 'tool_transition', id: row.id, input: { to: 'retry_wait', expectedRevision: row.revision, at, evidence: 'known_not_applied', events: [] } },
    transition(row, 'cancelled', at, row.revision + 1),
  ];
  const to = report.status === 'rejected' && row.status === 'ready' ? 'cancelled' : report.status;
  return [transition(row, to, at)];
}

function approvalCommands(session: DurableSession, row: ToolCallRecord, at: number): JournalCommand[] {
  const call = session.call(row.id);
  if (approvalFor(session, call) !== undefined) return [];
  const tool = session.context?.index.find(call.name);
  if (tool === undefined) throw new Error('Approval tool missing');
  const commands = row.status === 'proposed' ? [transition(row, 'awaiting_approval', at)] : [];
  const id = session.deps.ids.next('approval');
  const ttlMs = parseApprovalTtl(session.deps.approvalTtlMs);
  commands.push({ kind: 'approval_proposal', input: { id, at, expiresAt: at + ttlMs,
    binding: { runId: row.runId, toolCallId: row.id, tool: row.tool, argumentsDigest: row.argumentsDigest }, arguments: call.arguments,
    toolSnapshot: { inputSchema: tool.definition.inputSchema, ...(tool.definition.description === undefined ? {} : { description: tool.definition.description }),
      ...(tool.definition.annotations === undefined ? {} : { annotations: tool.definition.annotations }) },
    events: [] } });
  return commands;
}

/** Actionable notification commits with the pause, so an immediate HTTP decision sees waiting state. */
export function approvalEvents(session: DurableSession) {
  return session.checkpoint.approvals.filter(approval => approval.status === 'pending').map(approval => {
    const row = session.checkpoint.toolCalls.find(call => call.id === approval.binding.toolCallId);
    if (row === undefined) throw new Error('Approval lacks durable call correlation');
    return { ...session.event('approval.required', { approvalId: approval.id, revision: approval.revision }),
      stepId: row.stepId, toolCallId: row.id };
  });
}
