import { parseId } from '../identity/ids.js';
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from './message.js';
import { parseContent } from './parse-content.js';
import { parseJsonObject } from './json.js';
import { array, exactKeys, nonEmptyString, record } from './validation.js';

export function parseToolCall(input: unknown): ToolCall {
  const call = record(input, 'tool call');
  exactKeys(call, ['id', 'name', 'arguments']);
  return Object.freeze({
    id: parseId('tool_call', call['id']),
    name: nonEmptyString(call['name'], 'tool name'),
    arguments: parseJsonObject(call['arguments']),
  });
}

function parseAssistant(input: Record<string, unknown>): AssistantMessage {
  exactKeys(input, ['id', 'role', 'content', 'toolCalls']);
  const id = parseId('message', input['id']);
  const content = parseContent(input['content']);
  if (!Object.hasOwn(input, 'toolCalls')) {
    if (content.length === 0) throw new Error('Assistant message needs content or tool calls');
    return Object.freeze({ id, role: 'assistant', content });
  }
  const toolCalls = Object.freeze(array(input['toolCalls'], 'tool calls').map(parseToolCall));
  if (toolCalls.length === 0) throw new Error('Expected nonempty tool calls');
  return Object.freeze({ id, role: 'assistant', content, toolCalls });
}

function parseToolResult(input: Record<string, unknown>): ToolResultMessage {
  exactKeys(input, ['id', 'role', 'content', 'toolCallId', 'outcome']);
  const outcome = input['outcome'];
  if (outcome !== 'success' && outcome !== 'error' && outcome !== 'unknown') throw new Error('Invalid tool outcome');
  return Object.freeze({
    id: parseId('message', input['id']),
    role: 'tool',
    content: parseContent(input['content']),
    toolCallId: parseId('tool_call', input['toolCallId']),
    outcome,
  });
}

export function parseMessage(value: unknown): Message {
  const input = record(value, 'message');
  if (input['role'] === 'assistant') return parseAssistant(input);
  if (input['role'] === 'tool') return parseToolResult(input);
  exactKeys(input, ['id', 'role', 'content']);
  if (input['role'] !== 'system' && input['role'] !== 'user') throw new Error('Invalid message role');
  const content = parseContent(input['content']);
  if (content.length === 0) throw new Error('Context message needs content');
  return Object.freeze({ id: parseId('message', input['id']), role: input['role'], content });
}
