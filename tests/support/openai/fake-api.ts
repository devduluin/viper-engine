import OpenAI from 'openai';
import { OpenAIModelGateway } from '../../../src/adapters/models/openai/gateway.js';
import type { OpenAIRequestSettings } from '../../../src/adapters/models/openai/to-request.js';
import { TestClock } from '../agent/identity.js';

export interface FakeChatTurn {
  readonly text?: readonly string[];
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly argumentFragments: readonly string[] }[];
  readonly refusal?: string;
  readonly finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  readonly usage?: { readonly prompt: number; readonly completion: number };
}

export type FakeChatReply = FakeChatTurn | { readonly status: number; readonly errorType: string };

function chunk(delta: object, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
  })}\n\n`;
}

function toolChunks(turn: FakeChatTurn): string[] {
  return (turn.toolCalls ?? []).flatMap((call, index) => [
    chunk({ tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: '' } }] }),
    ...call.argumentFragments.map(fragment => chunk({ tool_calls: [{ index, function: { arguments: fragment } }] })),
  ]);
}

/** Chat Completions streaming body: deltas, a finish chunk, a usage chunk, then [DONE]. */
export function chatStreamBody(turn: FakeChatTurn): string {
  const usage = turn.usage ?? { prompt: 12, completion: 3 };
  const finish = turn.finishReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop');
  return [
    chunk({ role: 'assistant', content: '' }),
    ...(turn.text ?? []).map(text => chunk({ content: text })),
    ...(turn.refusal === undefined ? [] : [chunk({ refusal: turn.refusal })]),
    ...toolChunks(turn),
    chunk({}, finish),
    `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [],
      usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion } })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

/** Real OpenAI SDK client over a scripted fetch; records every request body. */
export class FakeOpenAI {
  readonly bodies: Record<string, unknown>[] = [];
  private cursor = 0;
  readonly client: OpenAI;

  constructor(private readonly replies: readonly FakeChatReply[]) {
    this.client = new OpenAI({ apiKey: 'test-key-not-real', maxRetries: 0, fetch: (_input, init) => this.fetch(init) });
  }

  private async fetch(init: RequestInit | undefined): Promise<Response> {
    this.bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const reply = this.replies[this.cursor];
    this.cursor += 1;
    if (reply === undefined) throw new Error('Fake OpenAI script exhausted');
    if ('status' in reply) {
      return new Response(JSON.stringify({ error: { type: reply.errorType, message: 'sensitive provider text', code: null, param: null } }),
        { status: reply.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(chatStreamBody(reply), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  gateway(settings: OpenAIRequestSettings = {}): OpenAIModelGateway {
    return new OpenAIModelGateway({ api: this.client.chat.completions, clock: new TestClock(Date.now()), settings });
  }
}
