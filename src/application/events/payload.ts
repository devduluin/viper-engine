import type { ReplayItem } from '../../contracts/events/replay.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { RunEventType } from '../../contracts/state/events.js';
import { publicMessage, approvalView } from '../api/projection.js';
import { questionText } from '../api/question.js';

function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Missing immutable event fact');
  return value;
}
function message(item: ReplayItem) {
  if (item.message === undefined || item.message.role === 'system') throw new Error('Missing public event message');
  return item.message;
}
function tool(item: ReplayItem): JsonObject {
  if (item.tool === undefined) throw new Error('Missing immutable tool binding');
  const ref = item.tool.tool;
  return { connectionId: ref.connectionId, serverId: ref.serverId, name: ref.name, definitionVersion: ref.definitionVersion };
}
function failedTool(item: ReplayItem): JsonObject {
  const m = message(item);
  if (m.role !== 'tool' || m.outcome === 'success' || m.toolCallId !== item.event.toolCallId) throw new Error('Invalid failed tool evidence');
  return { outcome: m.outcome, resultMessageId: m.id, failure: m.outcome === 'unknown'
    ? { code: 'OUTCOME_UNKNOWN', message: 'Remote effect has no confirmed outcome; reconcile before retry' }
    : { code: 'INVALID_STATE', message: 'Tool failed or was not dispatched; inspect its result message' } };
}
function approval(item: ReplayItem): JsonObject {
  if (item.approval === undefined || item.approval.binding.toolCallId !== item.event.toolCallId) throw new Error('Missing immutable approval snapshot');
  return { approval: approvalView({ ...item.approval, status: 'pending', revision: positive(item.event.payload['revision']) }) };
}
function terminalReason(item: ReplayItem): JsonObject {
  const reason = item.event.payload['reason'];
  if (reason === 'unknown_outcome') return { code: 'OUTCOME_UNKNOWN', message: 'Execution retains an unknown remote effect' };
  if (typeof reason === 'string' && /^(deadline_exceeded|.*_limit)$/.test(reason)) return {
    code: 'BUDGET_EXCEEDED', message: 'Execution reached its configured limit', limit: reason };
  return { code: 'INVALID_STATE', message: 'Execution did not complete; inspect the run snapshot and messages' };
}

/** The answer a partial/failed run still ended with (assistant text, no pending tool calls); else nothing. */
function finalAnswer(item: ReplayItem): JsonObject {
  const m = item.message;
  return m !== undefined && m.role === 'assistant' && m.toolCalls === undefined ? { finalMessageId: m.id } : {};
}

export function eventPayload(item: ReplayItem): JsonObject {
  const e = item.event;
  const run = (status: string): JsonObject => ({ status, revision: positive(e.payload['revision']) });
  const handlers: Record<RunEventType, () => JsonObject> = {
    'run.queued': () => run('queued'), 'run.started': () => run('running'), 'run.cancelled': () => run('cancelled'),
    'step.started': () => ({ index: positive(e.payload['index']) }),
    'tool.started': () => ({ tool: tool(item), attempt: positive(e.payload['attempt']) }),
    'message.completed': () => ({ message: publicMessage(message(item)) }),
    'tool.completed': () => {
      const m = message(item);
      if (m.role !== 'tool' || m.outcome !== 'success' || m.toolCallId !== e.toolCallId) throw new Error('Invalid successful tool evidence');
      return { outcome: 'success', resultMessageId: m.id };
    },
    'tool.failed': () => failedTool(item), 'approval.required': () => approval(item),
    'run.input_required': () => ({ question: questionText(message(item)), revision: positive(e.payload['revision']) }),
    'run.completed': () => {
      const m = message(item);
      if (m.role !== 'assistant' || m.toolCalls !== undefined) throw new Error('Missing confirmed final message');
      return { ...run('completed'), finalMessageId: m.id };
    },
    'run.partial': () => ({ ...run('partial'), reason: terminalReason(item), ...finalAnswer(item) }),
    'run.failed': () => ({ ...run('failed'), reason: terminalReason(item), ...finalAnswer(item) }),
  };
  return handlers[e.type]();
}
