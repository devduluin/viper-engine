import { array, id, literal, object, ref, text, uri } from './schema.js';
import type { Schema } from './schema.js';

const mediaType: Schema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^\\s/]+/[^\\s/]+$' };
const base64: Schema = { type: 'string', minLength: 1, maxLength: 33_554_432,
  pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' };
const source = { oneOf: [
  object({ kind: literal('inline'), mediaType, encoding: literal('base64'), data: base64 }),
  object({ kind: literal('reference'), mediaType, uri }),
] };

/** This is wire shape validation; JSON depth/bytes, media access and schema policy are separate gates. */
export const CONTENT_SCHEMAS = {
  TextContent: object({ type: literal('text'), text: { type: 'string', maxLength: 2_097_152 } }),
  JsonContent: object({ type: literal('json'), data: {} }),
  ImageContent: object({ type: literal('image'), source }),
  AudioContent: object({ type: literal('audio'), source }),
  ContentBlock: { oneOf: ['TextContent', 'JsonContent', 'ImageContent', 'AudioContent'].map(ref) },
  UserInput: object({ content: array(ref('ContentBlock'), 32, 1) }),
  ToolCall: object({ id, name: text, arguments: { type: 'object' } }),
  UserMessage: object({ id, role: literal('user'), content: array(ref('ContentBlock'), 32, 1) }),
  AssistantMessage: { oneOf: [
    object({ id, role: literal('assistant'), content: array(ref('ContentBlock'), 32, 1) }),
    object({ id, role: literal('assistant'), content: array(ref('ContentBlock'), 32),
      toolCalls: array(ref('ToolCall'), 32, 1) }),
  ] },
  ToolMessage: object({ id, role: literal('tool'), toolCallId: id,
    outcome: { enum: ['success', 'error', 'unknown'] }, content: array(ref('ContentBlock'), 32) }),
  PublicMessage: { oneOf: ['UserMessage', 'AssistantMessage', 'ToolMessage'].map(ref) },
  FinalMessage: object({ id, role: literal('assistant'), content: array(ref('ContentBlock'), 32, 1) }),
} as const;
