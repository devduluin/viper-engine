import type { JsonObject } from '../../contracts/messages/json.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { Message } from '../../contracts/messages/message.js';
import type { ApprovalRecord, RunRecord } from '../../contracts/state/records.js';
import type { RunCheckpoint } from '../../contracts/state/checkpoints.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ApiCursorPort } from '../../contracts/api/control.js';
import { publicContent } from './public-content.js';
import { questionText } from './question.js';
import { parseContextCheckpoint } from '../../contracts/context/parse-checkpoint.js';

export function accepted(run: RunRecord): JsonObject {
  return { schemaVersion: 1, runId: run.id, conversationId: run.conversationId, status: run.status, revision: run.revision,
    snapshotUrl: `/api/v1/runs/${encodeURIComponent(run.id)}` };
}

export function approvalView(record: ApprovalRecord): JsonObject {
  if (record.arguments === undefined) throw new Error('Approval has no reviewable snapshot');
  return parseJsonObject({ schemaVersion: 1, approvalId: record.id, revision: record.revision, status: record.status,
    proposal: { runId: record.binding.runId, toolCallId: record.binding.toolCallId,
      tool: { connectionId: record.binding.tool.connectionId, serverId: record.binding.tool.serverId,
        name: record.binding.tool.name, definitionVersion: record.binding.tool.definitionVersion }, argumentsDigest: record.binding.argumentsDigest },
    arguments: record.arguments, expiresAt: record.expiresAt });
}

export function publicMessage(message: Message): JsonObject {
  if (message.role === 'system') throw new Error('Private instruction is not public history');
  return parseJsonObject({ id: message.id, role: message.role, content: publicContent(message.content),
    ...(message.role === 'assistant' && message.toolCalls !== undefined ? { toolCalls: message.toolCalls } : {}),
    ...(message.role === 'tool' ? { toolCallId: message.toolCallId, outcome: message.outcome } : {}) });
}

export function runView(scope: TrustedScope, cp: RunCheckpoint, cursors: ApiCursorPort): JsonObject {
  const run = cp.run;
  const messages = cp.history.filter(message => cp.runMessageIds.includes(message.id));
  const last = [...messages].reverse().find(message => message.role === 'assistant');
  const question = run.status === 'waiting_for_input' && last !== undefined
    ? questionText(last) : undefined;
  const final = finalMessage(cp, last);
  return { schemaVersion: 1, runId: run.id, conversationId: run.conversationId, status: run.status, revision: run.revision,
    createdAt: run.createdAt, updatedAt: run.updatedAt, lastEventSequence: cp.lastEventSequence,
    eventCursor: cursors.issue(scope, 'event', run.id, String(cp.lastEventSequence)),
    pendingApprovals: cp.approvals.filter(approval => ['pending', 'accepted'].includes(approval.status)).map(approvalView),
    ...(run.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: run.cancelRequestedAt }),
    ...(question === undefined ? {} : { inputQuestion: question }), ...(final === undefined ? {} : { finalMessage: final }),
    ...(cp.usage === undefined ? {} : { usage: parseJsonObject(cp.usage) }), ...contextReport(cp) };
}

function contextReport(cp: RunCheckpoint): JsonObject {
  const context = cp.execution?.state['contextCheckpoint'];
  return context === undefined ? {} : { context: parseJsonObject(parseContextCheckpoint(context).report) };
}

function finalMessage(cp: RunCheckpoint, last: Message | undefined) {
  if (cp.execution?.state['phase'] !== 'final' || last?.role !== 'assistant' || last.toolCalls !== undefined) return undefined;
  return publicMessage(last);
}
