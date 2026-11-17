import type {
  BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Clock } from '../../../contracts/identity/ports.js';
import { parseId } from '../../../contracts/identity/ids.js';
import type { ModelCallId } from '../../../contracts/identity/ids.js';
import type {
  ModelCallOptions, ModelCapabilities, ModelGateway, ModelRequest, ModelResult, ModelStreamEvent,
} from '../../../contracts/models/gateway.js';
import type { ModelDecision } from '../../../contracts/models/decision.js';
import type { ModelUsage } from '../../../contracts/models/usage.js';
import { assertModelCallOptions, assertModelRequest } from '../../../contracts/models/request-validation.js';
import { modelFailureFrom } from './errors.js';
import { interpretMessage, usageFrom } from './from-response.js';
import { AssistantReplayCache, assistantKey } from './replay-cache.js';
import type { AnthropicRequestSettings } from './to-request.js';
import { toAnthropicParams } from './to-request.js';
import { withDeadline } from '../../../shared/async/deadline.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';

/** The slice of `client.beta.messages` this adapter uses; tests supply a recorded transport. */
export interface AnthropicStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
  abort(): void;
}

export interface AnthropicMessagesApi {
  stream(params: BetaMessageStreamParams, options?: { signal?: AbortSignal; timeout?: number }): AnthropicStream;
}

export interface AnthropicGatewayOptions {
  readonly api: AnthropicMessagesApi;
  readonly clock: Clock;
  readonly settings: AnthropicRequestSettings;
  readonly replayCache?: AssistantReplayCache;
  readonly requestTimeoutMs?: number;
}

export const ANTHROPIC_CAPABILITIES: ModelCapabilities = Object.freeze({
  toolCalling: true, streaming: true, structuredOutput: true,
  contentTypes: Object.freeze(['text', 'image', 'json'] as const),
});

const UNAVAILABLE = Object.freeze({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } as const);

type Relay = (event: ModelStreamEvent) => void | Promise<void>;

/** Deltas are provisional display data; only the final message becomes a decision. */
async function relay(event: BetaRawMessageStreamEvent, id: ModelCallId, tools: Map<number, string>, onEvent: Relay): Promise<void> {
  if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    tools.set(event.index, event.content_block.id);
    return;
  }
  if (event.type !== 'content_block_delta') return;
  if (event.delta.type === 'text_delta') await onEvent({ type: 'text_delta', modelCallId: id, text: event.delta.text });
  const toolCallId = tools.get(event.index);
  if (event.delta.type === 'input_json_delta' && toolCallId !== undefined) {
    await onEvent({ type: 'tool_call_delta', modelCallId: id, toolCallId: parseId('tool_call', toolCallId), argumentsDelta: event.delta.partial_json });
  }
}

function decisionShape(decision: ModelDecision) {
  if (decision.kind === 'tool_calls') return { content: decision.content, toolCalls: decision.calls };
  return { content: decision.kind === 'final' ? decision.content : [{ type: 'text' as const, text: decision.question }] };
}

/**
 * ModelGateway over the Anthropic Messages API (beta surface for thinking-binding controls and
 * refusal fallbacks). Always streams, with a deadline covering consumption and observers. Infrastructure and
 * provider failures come back as `ok: false`; invalid engine requests throw before any call.
 */
export class AnthropicModelGateway implements ModelGateway {
  readonly capabilities = ANTHROPIC_CAPABILITIES;
  private readonly cache: AssistantReplayCache;
  private readonly timeoutMs: number;

  constructor(private readonly options: AnthropicGatewayOptions) {
    this.cache = options.replayCache ?? new AssistantReplayCache();
    this.timeoutMs = options.requestTimeoutMs ?? 600_000;
    assertTimerDuration('model request timeout', this.timeoutMs);
    if (this.timeoutMs === 0) throw new RangeError('Model request timeout must be positive');
  }

  async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResult> {
    assertModelCallOptions(this.capabilities, options);
    const now = this.options.clock.now();
    assertModelRequest(request, this.capabilities, now);
    const params = toAnthropicParams(request, this.options.settings, this.cache);
    try {
      const { message, usage } = await this.call(params, request, options, now);
      const result = interpretMessage(message);
      if (!result.ok) return { ok: false, error: result.error, usage };
      this.cache.remember(assistantKey(request, decisionShape(result.decision)), message.content);
      return { ok: true, decision: result.decision, usage };
    } catch (error) {
      return { ok: false, error: modelFailureFrom(error, options.signal), usage: UNAVAILABLE };
    }
  }

  private async call(params: BetaMessageStreamParams, request: ModelRequest, options: ModelCallOptions, now: number): Promise<{
    message: BetaMessage; usage: ModelUsage;
  }> {
    const timeout = Math.max(0, Math.min(this.timeoutMs, (request.deadlineAt ?? Infinity) - now));
    let stream: AnthropicStream | undefined;
    try {
      return await withDeadline(async signal => {
        stream = this.options.api.stream(params, { signal, timeout });
        if (options.onEvent !== undefined) {
          const tools = new Map<number, string>();
          for await (const event of stream) await relay(event, request.modelCallId, tools, options.onEvent);
        }
        const message = await stream.finalMessage();
        const usage = usageFrom(message.usage);
        await options.onEvent?.({ type: 'usage', modelCallId: request.modelCallId, usage });
        return { message, usage };
      }, { operationName: 'Anthropic stream', timeoutMs: timeout, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    } finally { stream?.abort(); }
  }
}
