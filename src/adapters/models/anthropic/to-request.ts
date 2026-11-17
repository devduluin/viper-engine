import type {
  BetaContentBlockParam, BetaImageBlockParam, BetaMessageParam, BetaMessageStreamParams, BetaTextBlockParam, BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ContentBlock } from '../../../contracts/messages/content.js';
import type { AssistantMessage, Message, ToolResultMessage } from '../../../contracts/messages/message.js';
import type { ModelRequest, ModelToolDefinition } from '../../../contracts/models/gateway.js';
import type { AssistantReplayCache } from './replay-cache.js';
import { assistantKey } from './replay-cache.js';

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicRequestSettings {
  readonly effort: AnthropicEffort;
  /** Server-side refusal fallback (`fallbacks: "default"`), on by default. */
  readonly fallbacks: boolean;
}

const BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models documented to accept server-side `fallbacks: "default"`; others never receive it. */
export const FALLBACK_MODELS: ReadonlySet<string> = new Set([
  'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5',
]);
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function imageType(value: string): ImageType {
  const found = IMAGE_TYPES.find(type => type === value);
  if (found === undefined) throw new Error(`Unsupported image media type for this provider: ${value}`);
  return found;
}

function image(block: Extract<ContentBlock, { type: 'image' }>): BetaImageBlockParam {
  const { source } = block;
  return source.kind === 'inline'
    ? { type: 'image', source: { type: 'base64', media_type: imageType(source.mediaType), data: source.data } }
    : { type: 'image', source: { type: 'url', url: source.uri } };
}

/** Engine content → provider blocks. JSON is sent as its canonical text; audio is not offered. */
function contentBlock(block: ContentBlock): BetaTextBlockParam | BetaImageBlockParam {
  switch (block.type) {
    case 'text': return { type: 'text', text: block.text };
    case 'json': return { type: 'text', text: JSON.stringify(block.data) };
    case 'image': return image(block);
    case 'audio': throw new Error('Audio content is not supported by this provider');
  }
}

function assistantParam(message: AssistantMessage, cache: AssistantReplayCache, request: ModelRequest, prefix: readonly Message[]): BetaMessageParam {
  const replay = cache.recall(assistantKey(request, message, prefix));
  if (replay !== undefined) return { role: 'assistant', content: [...replay] };
  const content: BetaContentBlockParam[] = message.content.map(contentBlock);
  for (const call of message.toolCalls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
  return { role: 'assistant', content };
}

function toolResult(message: ToolResultMessage): BetaToolResultBlockParam {
  const content = message.content.map(contentBlock);
  return {
    type: 'tool_result', tool_use_id: message.toolCallId, is_error: message.outcome !== 'success',
    ...(content.length === 0 ? {} : { content }),
  };
}

/**
 * Leading system messages become the top-level system prompt. All results of one assistant turn
 * go back in a single user message, which keeps parallel tool use working.
 */
export function toMessages(request: ModelRequest, cache: AssistantReplayCache): { system: string[]; messages: BetaMessageParam[] } {
  const messages = request.messages;
  const system: string[] = [];
  const out: BetaMessageParam[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === 'system') {
      if (out.length > 0) throw new Error('System messages are only supported before the conversation');
      system.push(...message.content.map(block => (block.type === 'text' ? block.text : JSON.stringify(block))));
    } else if (message.role === 'assistant') {
      out.push(assistantParam(message, cache, request, messages.slice(0, index)));
    } else if (message.role === 'tool') {
      const last = out.at(-1);
      const result = toolResult(message);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(block => block.type === 'tool_result')) {
        last.content.push(result);
      } else {
        out.push({ role: 'user', content: [result] });
      }
    } else {
      out.push({ role: 'user', content: message.content.map(contentBlock) });
    }
  }
  return { system, messages: out };
}

function tool(definition: ModelToolDefinition): BetaTool {
  if (definition.inputSchema['type'] !== 'object') throw new Error(`Tool ${definition.name} needs an object input schema`);
  return {
    name: definition.name, input_schema: { ...definition.inputSchema, type: 'object' },
    ...(definition.description === undefined ? {} : { description: definition.description }),
  };
}

function fallbackFields(model: string, settings: AnthropicRequestSettings) {
  return settings.fallbacks && FALLBACK_MODELS.has(model)
    ? { betas: [BINDING_BETA, FALLBACK_BETA], fallbacks: 'default' as const }
    : { betas: [BINDING_BETA] };
}

/**
 * Adaptive thinking (always on for current models) with `drop_block`: a thinking block whose
 * conversation check fails is dropped by the API instead of failing the turn.
 */
export function toAnthropicParams(
  request: ModelRequest, settings: AnthropicRequestSettings, cache: AssistantReplayCache,
): BetaMessageStreamParams {
  const { system, messages } = toMessages(request, cache);
  return {
    model: request.model, max_tokens: request.maxOutputTokens, messages,
    ...(system.length === 0 ? {} : { system: system.join('\n\n') }),
    ...(request.tools.length === 0 ? {} : { tools: request.tools.map(tool) }),
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: {
      effort: settings.effort,
      ...(request.responseSchema === undefined ? {} : { format: { type: 'json_schema', schema: { ...request.responseSchema } } }),
    },
    ...fallbackFields(request.model, settings),
  };
}
