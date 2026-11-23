import type {
  ChatCompletionContentPart, ChatCompletionFunctionTool, ChatCompletionMessageParam, ChatCompletionStreamParams,
} from 'openai/resources/chat/completions/completions';
import type { ContentBlock } from '../../../contracts/messages/content.js';
import type { AssistantMessage, Message, ToolResultMessage } from '../../../contracts/messages/message.js';
import type { ModelRequest, ModelToolDefinition } from '../../../contracts/models/gateway.js';

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface OpenAIRequestSettings {
  /** Sent only when configured; models without reasoning reject the field. */
  readonly reasoningEffort?: OpenAIReasoningEffort;
  /** Compatible Chat Completions endpoints can require the older output-limit field. */
  readonly tokenParameter?: 'max_tokens';
  readonly structuredOutput?: boolean;
}

function text(block: ContentBlock): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'json') return JSON.stringify(block.data);
  throw new Error(`Content type ${block.type} is only supported in user messages for this provider`);
}

function userPart(block: ContentBlock): ChatCompletionContentPart {
  if (block.type === 'audio') throw new Error('Audio content is not supported by this adapter');
  if (block.type !== 'image') return { type: 'text', text: text(block) };
  const { source } = block;
  const url = source.kind === 'inline' ? `data:${source.mediaType};base64,${source.data}` : source.uri;
  return { type: 'image_url', image_url: { url } };
}

function assistant(message: AssistantMessage): ChatCompletionMessageParam {
  const content = message.content.map(text).join('');
  const calls = (message.toolCalls ?? []).map(call => ({
    id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  return {
    role: 'assistant', content: content.length === 0 ? null : content,
    ...(calls.length === 0 ? {} : { tool_calls: calls }),
  };
}

/** The outcome is stated explicitly, since this API has no is_error flag on tool messages. */
function toolResult(message: ToolResultMessage): ChatCompletionMessageParam {
  const body = message.content.map(block => block.type === 'image' ? '[Tool image attached in the following user message]' : text(block)).join('\n');
  const content = message.outcome === 'success' ? body : `[tool outcome: ${message.outcome}]\n${body}`;
  return { role: 'tool', tool_call_id: message.toolCallId, content };
}

function messageParam(message: Message): ChatCompletionMessageParam {
  switch (message.role) {
    case 'system': return { role: 'system', content: message.content.map(text).join('\n\n') };
    case 'user': return { role: 'user', content: message.content.map(userPart) };
    case 'assistant': return assistant(message);
    case 'tool': return toolResult(message);
  }
}

export function toMessages(messages: readonly Message[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];
  let images: ChatCompletionContentPart[] = [];
  for (const message of messages) {
    if (message.role !== 'tool' && images.length > 0) {
      result.push({ role: 'user', content: images }); images = [];
    }
    result.push(messageParam(message));
    if (message.role === 'tool') {
      const content = message.content.filter(block => block.type === 'image');
      if (content.length > 0) images.push({ type: 'text', text: `Images from tool call ${message.toolCallId}` }, ...content.map(userPart));
    }
  }
  if (images.length > 0) result.push({ role: 'user', content: images });
  return result;
}

function tool(definition: ModelToolDefinition): ChatCompletionFunctionTool {
  return {
    type: 'function',
    function: {
      name: definition.name, parameters: { ...definition.inputSchema },
      ...(definition.description === undefined ? {} : { description: definition.description }),
    },
  };
}

/** Chat Completions request; always streamed with usage in the final chunk. */
export function toOpenAIParams(request: ModelRequest, settings: OpenAIRequestSettings): ChatCompletionStreamParams {
  return {
    model: request.model, messages: toMessages(request.messages),
    ...(settings.tokenParameter === 'max_tokens' ? { max_tokens: request.maxOutputTokens } : { max_completion_tokens: request.maxOutputTokens }),
    stream: true, stream_options: { include_usage: true },
    ...(request.tools.length === 0 ? {} : { tools: request.tools.map(tool) }),
    ...(settings.reasoningEffort === undefined ? {} : { reasoning_effort: settings.reasoningEffort }),
    ...(request.responseSchema === undefined ? {} : {
      response_format: { type: 'json_schema', json_schema: { name: 'response', schema: { ...request.responseSchema } } },
    }),
  };
}
