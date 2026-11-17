import type { ChatCompletion, ChatCompletionChunk, ChatCompletionStreamParams } from 'openai/resources/chat/completions/completions';
import { parseId } from '../../../contracts/identity/ids.js';
import type { ModelCallId } from '../../../contracts/identity/ids.js';
import type { Clock } from '../../../contracts/identity/ports.js';
import type {
  ModelCallOptions, ModelCapabilities, ModelGateway, ModelRequest, ModelResult, ModelStreamEvent,
} from '../../../contracts/models/gateway.js';
import { assertModelCallOptions, assertModelRequest } from '../../../contracts/models/request-validation.js';
import { modelFailureFrom } from './errors.js';
import { interpretCompletion, usageFrom } from './from-response.js';
import type { OpenAIRequestSettings } from './to-request.js';
import { toOpenAIParams } from './to-request.js';
import { withDeadline } from '../../../shared/async/deadline.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';
import type { ModelUsage } from '../../../contracts/models/usage.js';

/** The slice of `client.chat.completions` this adapter uses; tests supply a scripted transport. */
export interface OpenAIChatStream extends AsyncIterable<ChatCompletionChunk> {
  finalChatCompletion(): Promise<ChatCompletion>;
  abort(): void;
}

export interface OpenAIChatApi {
  stream(params: ChatCompletionStreamParams, options?: { signal?: AbortSignal; timeout?: number }): OpenAIChatStream;
}

export interface OpenAIGatewayOptions {
  readonly api: OpenAIChatApi;
  readonly clock: Clock;
  readonly settings: OpenAIRequestSettings;
  readonly requestTimeoutMs?: number;
}

export const OPENAI_CAPABILITIES: ModelCapabilities = Object.freeze({
  toolCalling: true, streaming: true, structuredOutput: true,
  contentTypes: Object.freeze(['text', 'image', 'json'] as const),
});

const UNAVAILABLE = Object.freeze({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } as const);

type Relay = (event: ModelStreamEvent) => void | Promise<void>;

/** Tool call IDs arrive once per index; later argument fragments refer to the index only. */
async function relayToolCalls(delta: ChatCompletionChunk.Choice.Delta, id: ModelCallId, tools: Map<number, string>, onEvent: Relay): Promise<void> {
  for (const call of delta.tool_calls ?? []) {
    if (call.id !== undefined) tools.set(call.index, call.id);
    const toolCallId = tools.get(call.index);
    const fragment = call.function?.arguments ?? '';
    if (toolCallId !== undefined && fragment.length > 0) {
      await onEvent({ type: 'tool_call_delta', modelCallId: id, toolCallId: parseId('tool_call', toolCallId), argumentsDelta: fragment });
    }
  }
}

async function relay(chunk: ChatCompletionChunk, id: ModelCallId, tools: Map<number, string>, onEvent: Relay): Promise<void> {
  const delta = chunk.choices[0]?.delta;
  if (delta === undefined) return;
  if (typeof delta.content === 'string' && delta.content.length > 0) await onEvent({ type: 'text_delta', modelCallId: id, text: delta.content });
  await relayToolCalls(delta, id, tools, onEvent);
}

/**
 * ModelGateway over OpenAI Chat Completions (also usable with compatible endpoints via the
 * client's base URL). Always streams; provider failures come back as `ok: false`.
 */
export class OpenAIModelGateway implements ModelGateway {
  readonly capabilities = OPENAI_CAPABILITIES;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAIGatewayOptions) {
    this.timeoutMs = options.requestTimeoutMs ?? 600_000;
    assertTimerDuration('model request timeout', this.timeoutMs);
    if (this.timeoutMs === 0) throw new RangeError('Model request timeout must be positive');
  }

  async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResult> {
    assertModelCallOptions(this.capabilities, options);
    const now = this.options.clock.now();
    assertModelRequest(request, this.capabilities, now);
    const params = toOpenAIParams(request, this.options.settings);
    try {
      const { completion, usage } = await this.call(params, request, options, now);
      const result = interpretCompletion(completion);
      return result.ok ? { ok: true, decision: result.decision, usage } : { ok: false, error: result.error, usage };
    } catch (error) {
      return { ok: false, error: modelFailureFrom(error, options.signal), usage: UNAVAILABLE };
    }
  }

  private async call(params: ChatCompletionStreamParams, request: ModelRequest, options: ModelCallOptions, now: number): Promise<{
    completion: ChatCompletion; usage: ModelUsage;
  }> {
    const timeout = Math.max(0, Math.min(this.timeoutMs, (request.deadlineAt ?? Infinity) - now));
    let stream: OpenAIChatStream | undefined;
    try {
      return await withDeadline(async signal => {
        stream = this.options.api.stream(params, { signal, timeout });
        if (options.onEvent !== undefined) {
          const tools = new Map<number, string>();
          for await (const chunk of stream) await relay(chunk, request.modelCallId, tools, options.onEvent);
        }
        const completion = await stream.finalChatCompletion();
        const usage = usageFrom(completion.usage);
        await options.onEvent?.({ type: 'usage', modelCallId: request.modelCallId, usage });
        return { completion, usage };
      }, { operationName: 'OpenAI stream', timeoutMs: timeout, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    } finally { stream?.abort(); }
  }
}
