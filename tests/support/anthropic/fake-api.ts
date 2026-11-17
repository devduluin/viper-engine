import Anthropic from '@anthropic-ai/sdk';
import { AnthropicModelGateway } from '../../../src/adapters/models/anthropic/gateway.js';
import type { AnthropicRequestSettings } from '../../../src/adapters/models/anthropic/to-request.js';
import { TestClock } from '../agent/identity.js';

export type FakeBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'thinking'; readonly thinking: string; readonly signature: string };

export interface FakeTurn {
  readonly blocks: readonly FakeBlock[];
  readonly stopReason?: string;
  readonly stopDetails?: Record<string, unknown>;
  readonly usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

export type FakeReply = FakeTurn | { readonly status: number; readonly errorType: string } | 'hang';

function sse(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
}

function blockEvents(block: FakeBlock, index: number): string[] {
  if (block.type === 'text') {
    return [sse('content_block_start', { index, content_block: { type: 'text', text: '' } }),
      sse('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } })];
  }
  if (block.type === 'tool_use') {
    return [sse('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }),
      sse('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })];
  }
  return [sse('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    sse('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: block.thinking } }),
    sse('content_block_delta', { index, delta: { type: 'signature_delta', signature: block.signature } })];
}

/** Server-sent event body exactly as the Messages streaming API frames it. */
export function streamBody(turn: FakeTurn): string {
  const usage = turn.usage ?? { input: 10, output: 5 };
  const start = sse('message_start', { message: {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0 },
  } });
  const blocks = turn.blocks.flatMap((block, index) => [...blockEvents(block, index), sse('content_block_stop', { index })]);
  const end = sse('message_delta', {
    delta: { stop_reason: turn.stopReason ?? (turn.blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      stop_sequence: null, ...(turn.stopDetails === undefined ? {} : { stop_details: turn.stopDetails }) },
    usage: { output_tokens: usage.output },
  });
  return [start, ...blocks, end, sse('message_stop', {})].join('');
}

/** Real SDK client over a scripted fetch; records every request body sent to /v1/messages. */
export class FakeAnthropic {
  readonly bodies: Record<string, unknown>[] = [];
  readonly headers: Headers[] = [];
  private cursor = 0;
  readonly client: Anthropic;

  constructor(private readonly replies: readonly FakeReply[]) {
    this.client = new Anthropic({ apiKey: 'test-key-not-real', maxRetries: 0, fetch: (_input, init) => this.fetch(init) });
  }

  private async fetch(init: RequestInit | undefined): Promise<Response> {
    this.bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    this.headers.push(new Headers(init?.headers));
    const reply = this.replies[this.cursor];
    this.cursor += 1;
    if (reply === undefined) throw new Error('Fake Anthropic script exhausted');
    if (reply === 'hang') return this.hang(init?.signal ?? undefined);
    if ('status' in reply) {
      return new Response(JSON.stringify({ type: 'error', error: { type: reply.errorType, message: 'sensitive provider text' } }),
        { status: reply.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(streamBody(reply), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  private hang(signal: AbortSignal | undefined): Promise<Response> {
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }

  gateway(settings: AnthropicRequestSettings = { effort: 'low', fallbacks: true }): AnthropicModelGateway {
    return new AnthropicModelGateway({ api: this.client.beta.messages, clock: new TestClock(Date.now()), settings });
  }
}
