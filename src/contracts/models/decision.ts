import type { ContentBlock } from '../messages/content.js';
import { parseContent } from '../messages/parse-content.js';
import { parseJsonObject } from '../messages/json.js';
import type { JsonObject } from '../messages/json.js';
import { parseToolCall } from '../messages/parse-message.js';
import type { ToolCall } from '../messages/message.js';

export type ModelDecision =
  | { readonly kind: 'final'; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'tool_calls'; readonly calls: readonly ToolCall[]; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'needs_input'; readonly question: string };

function assertFields(input: object, fields: readonly string[]): void {
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unexpected decision field');
}

function parseClarification(input: JsonObject): ModelDecision {
  assertFields(input, ['kind', 'question']);
  const question = input['question'];
  if (typeof question !== 'string' || question.trim().length === 0) throw new Error('Clarification needs a question');
  return Object.freeze({ kind: 'needs_input', question });
}

export function parseModelDecision(value: unknown): ModelDecision {
  const input = parseJsonObject(value);
  if (input['kind'] === 'final') {
    assertFields(input, ['kind', 'content']);
    const content = parseContent(input['content']);
    if (content.length === 0) throw new Error('Final decision needs content');
    return Object.freeze({ kind: 'final', content });
  }
  if (input['kind'] === 'needs_input') return parseClarification(input);
  assertFields(input, ['kind', 'calls', 'content']);
  if (input['kind'] !== 'tool_calls' || !Array.isArray(input['calls'])) throw new Error('Invalid model decision');
  const calls = Object.freeze(input['calls'].map(parseToolCall));
  if (calls.length === 0 || new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('Tool calls need unique IDs');
  const content = Object.hasOwn(input, 'content') ? parseContent(input['content']) : Object.freeze([]);
  return Object.freeze({ kind: 'tool_calls', calls, content });
}
