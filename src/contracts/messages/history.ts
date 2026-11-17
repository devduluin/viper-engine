import type { MessageId, ToolCallId } from '../identity/ids.js';
import type { AssistantMessage, Message } from './message.js';
import { parseMessage } from './parse-message.js';
import { array } from './validation.js';

export interface HistoryValidationOptions {
  /** False when building a model request that requires all outstanding tool results. */
  readonly allowPendingToolCalls?: boolean;
}

function registerCalls(message: AssistantMessage, seen: Set<ToolCallId>, pending: Set<ToolCallId>): void {
  for (const call of message.toolCalls ?? []) {
    if (seen.has(call.id)) throw new Error('Duplicate tool call identifier');
    seen.add(call.id);
    pending.add(call.id);
  }
}

/** Validates correlation without imposing a provider-specific role alternation rule. */
export function assertMessageHistory(messages: readonly Message[], options: HistoryValidationOptions = {}): void {
  const messageIds = new Set<MessageId>();
  const seenCalls = new Set<ToolCallId>();
  const pending = new Set<ToolCallId>();
  for (const message of messages) {
    if (messageIds.has(message.id)) throw new Error('Duplicate message identifier');
    messageIds.add(message.id);
    if (message.role === 'assistant') registerCalls(message, seenCalls, pending);
    if (message.role === 'tool' && !pending.delete(message.toolCallId)) {
      throw new Error('Tool result has no unmatched preceding call');
    }
  }
  if (options.allowPendingToolCalls === false && pending.size > 0) throw new Error('Tool results are still pending');
}

export function parseMessageHistory(input: unknown, options: HistoryValidationOptions = {}): readonly Message[] {
  const messages = Object.freeze(array(input, 'message history').map(parseMessage));
  assertMessageHistory(messages, options);
  return messages;
}
