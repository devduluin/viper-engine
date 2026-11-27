import type { ContextBudget } from '../../contracts/context/budget.js';
import type { MessageId } from '../../contracts/identity/ids.js';
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from '../../contracts/messages/message.js';
import type { ModelRequest } from '../../contracts/models/gateway.js';

const encoder = new TextEncoder();
const COMPACTED_ARGS = Object.freeze({ _compacted: true });
const COMPACTED_TEXT_BLOCK = Object.freeze({ type: 'text' as const, text: '[Assistant text compacted]' });

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function compactedToolMessage(message: ToolResultMessage): ToolResultMessage {
  const text = `[Tool output compacted (${jsonBytes(message.content)} bytes omitted)]`;
  return Object.freeze({ ...message, content: Object.freeze([Object.freeze({ type: 'text' as const, text })]) });
}

function compactedCall(call: ToolCall): ToolCall {
  return jsonBytes(call.arguments) > jsonBytes(COMPACTED_ARGS)
    ? Object.freeze({ ...call, arguments: COMPACTED_ARGS })
    : call;
}

function compactedAssistantMessage(message: AssistantMessage): AssistantMessage {
  const content = message.content.length > 0 && jsonBytes(message.content) > jsonBytes([COMPACTED_TEXT_BLOCK])
    ? Object.freeze([COMPACTED_TEXT_BLOCK])
    : message.content;
  const toolCalls = message.toolCalls ? Object.freeze(message.toolCalls.map(compactedCall)) : undefined;
  return Object.freeze(toolCalls ? { ...message, content, toolCalls } : { ...message, content });
}

function compactMessage(message: Message): Message {
  if (message.role === 'tool') return compactedToolMessage(message);
  if (message.role === 'assistant') return compactedAssistantMessage(message);
  return message;
}

function compactableToolIndices(messages: readonly Message[], protectedIds: ReadonlySet<MessageId>): readonly number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== 'tool' || message.outcome === 'unknown' || !protectedIds.has(message.id)) continue;
    if (jsonBytes(message.content) > jsonBytes(compactedToolMessage(message).content)) indices.push(i);
  }
  return indices;
}

function unknownCallIds(messages: readonly Message[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool' && message.outcome === 'unknown') ids.add(message.toolCallId);
  }
  return ids;
}

function compactableAssistantIndices(messages: readonly Message[], protectedIds: ReadonlySet<MessageId>): readonly number[] {
  const protectedCalls = unknownCallIds(messages);
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== 'assistant' || !protectedIds.has(message.id)) continue;
    if (message.toolCalls?.some(call => protectedCalls.has(call.id))) continue;
    if (jsonBytes(message) > jsonBytes(compactedAssistantMessage(message))) indices.push(i);
  }
  return indices;
}

function applyCompaction(messages: readonly Message[], indices: readonly number[], count: number): readonly Message[] {
  const targets = new Set(indices.slice(0, count));
  return Object.freeze(messages.map((message, index) => (targets.has(index) ? compactMessage(message) : message)));
}

function binaryCompact(
  request: ModelRequest,
  indices: readonly number[],
  budget: ContextBudget,
  fits: (candidate: ModelRequest, budget: ContextBudget) => boolean,
): { readonly request: ModelRequest; readonly fitted: boolean } {
  if (indices.length === 0) return { request, fitted: false };
  const maxRequest: ModelRequest = { ...request, messages: applyCompaction(request.messages, indices, indices.length) };
  if (!fits(maxRequest, budget)) return { request: maxRequest, fitted: false };
  let low = 1;
  let high = indices.length;
  let best = maxRequest;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const next: ModelRequest = { ...request, messages: applyCompaction(request.messages, indices, middle) };
    if (fits(next, budget)) { best = next; high = middle - 1; } else low = middle + 1;
  }
  return { request: best, fitted: true };
}

/**
 * Two-stage fallback compaction inside the active turn when inter-turn summarization alone still exceeds the context
 * budget. Stage 1 compacts oldest completed tool outputs; Stage 2 compacts oldest assistant text and tool arguments
 * (excluding proposals tied to unknown tool outcomes) while keeping the most recent steps intact.
 */
export function compactIntraTurn(
  request: ModelRequest,
  protectedIds: ReadonlySet<MessageId>,
  budget: ContextBudget,
  fits: (candidate: ModelRequest, budget: ContextBudget) => boolean,
): ModelRequest | undefined {
  const stage1 = binaryCompact(request, compactableToolIndices(request.messages, protectedIds), budget, fits);
  if (stage1.fitted) return stage1.request;
  const stage2 = binaryCompact(stage1.request, compactableAssistantIndices(stage1.request.messages, protectedIds), budget, fits);
  return stage2.fitted ? stage2.request : undefined;
}
