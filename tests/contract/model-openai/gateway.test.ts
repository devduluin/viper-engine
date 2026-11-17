import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { ModelRequest, ModelStreamEvent } from '../../../src/contracts/models/gateway.js';
import { parseOpenAIModelConfig } from '../../../src/bootstrap/openai-model.js';
import { testScope } from '../../support/agent/setup.js';
import { FakeOpenAI } from '../../support/openai/fake-api.js';

const tool = { name: 'inv__lookup', description: 'Lookup', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } };
const system = parseMessage({ id: 's', role: 'system', content: [{ type: 'text', text: 'Use tools.' }] });
const user = parseMessage({ id: 'u', role: 'user', content: [
  { type: 'text', text: 'Stock?' }, { type: 'image', source: { kind: 'inline', mediaType: 'image/png', encoding: 'base64', data: 'aGk=' } }] });

function request(messages: readonly Message[], extra: Partial<ModelRequest> = {}): ModelRequest {
  return {
    scope: testScope(), conversationId: parseId('conversation', 'c'), runId: parseId('run', 'r'), stepId: parseId('step', 's'),
    modelCallId: parseId('model_call', 'm'), model: 'test-model', maxOutputTokens: 500, messages, tools: [tool], ...extra,
  };
}

test('request: roles, image data URL, function tools, token limit, effort and streamed usage', async () => {
  const fake = new FakeOpenAI([{ text: ['ok'] }, { text: ['ok'] }]);
  await fake.gateway({ reasoningEffort: 'low' }).generate(request([system, user], { responseSchema: { type: 'object' } }));
  const body = fake.bodies[0]!;
  assert.deepEqual(body['messages'], [
    { role: 'system', content: 'Use tools.' },
    { role: 'user', content: [{ type: 'text', text: 'Stock?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }] },
  ]);
  assert.deepEqual(body['tools'], [{ type: 'function', function: { name: 'inv__lookup', description: 'Lookup', parameters: tool.inputSchema } }]);
  assert.deepEqual([body['max_completion_tokens'], body['reasoning_effort'], body['stream']], [500, 'low', true]);
  assert.deepEqual(body['stream_options'], { include_usage: true });
  assert.deepEqual(body['response_format'], { type: 'json_schema', json_schema: { name: 'response', schema: { type: 'object' } } });
  await fake.gateway().generate(request([user]));
  assert.equal('reasoning_effort' in fake.bodies[1]!, false);
});

test('history: assistant tool_calls and tool messages keep IDs; failed outcomes are stated', async () => {
  const fake = new FakeOpenAI([{ text: ['Done'] }]);
  const assistant = parseMessage({ id: 'a', role: 'assistant', content: [{ type: 'text', text: 'Checking' }],
    toolCalls: [{ id: 'call_1', name: 'inv__lookup', arguments: { id: 'a' } }] });
  const unknown = parseMessage({ id: 't', role: 'tool', toolCallId: 'call_1', outcome: 'unknown', content: [{ type: 'json', data: { status: 'unknown' } }] });
  await fake.gateway().generate(request([user, assistant, unknown]));
  assert.deepEqual((fake.bodies[0]!['messages'] as unknown[]).slice(1), [
    { role: 'assistant', content: 'Checking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'inv__lookup', arguments: '{"id":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: '[tool outcome: unknown]\n{"status":"unknown"}' },
  ]);
});

test('streamed tool call fragments assemble into a tool_calls decision with usage and deltas', async () => {
  const fake = new FakeOpenAI([{ text: ['Let me check.'], usage: { prompt: 40, completion: 9 },
    toolCalls: [{ id: 'call_9', name: 'inv__lookup', argumentFragments: ['{"id":', '"item-1"}'] }] }]);
  const events: ModelStreamEvent[] = [];
  const result = await fake.gateway().generate(request([user]), { onEvent: async event => { events.push(event); } });
  assert.ok(result.ok && result.decision.kind === 'tool_calls');
  assert.deepEqual(result.decision.calls, [{ id: 'call_9', name: 'inv__lookup', arguments: { id: 'item-1' } }]);
  assert.deepEqual(result.decision.content, [{ type: 'text', text: 'Let me check.' }]);
  assert.deepEqual(result.usage, { source: 'provider', inputTokens: 40, outputTokens: 9, totalTokens: 49 });
  assert.deepEqual(events.map(event => event.type), ['text_delta', 'tool_call_delta', 'tool_call_delta', 'usage']);
  assert.deepEqual(events.filter(event => event.type === 'tool_call_delta').map(event => event.type === 'tool_call_delta' && event.toolCallId), ['call_9', 'call_9']);
});

test('length, content filter, refusal, bad arguments and empty output are failures', async () => {
  const fake = new FakeOpenAI([
    { toolCalls: [{ id: 'c', name: 'inv__lookup', argumentFragments: ['{"id":'] }], finishReason: 'length' },
    { text: ['x'], finishReason: 'content_filter' },
    { refusal: 'I cannot help with that.' },
    { toolCalls: [{ id: 'c2', name: 'inv__lookup', argumentFragments: ['not json'] }] },
    { text: [] },
  ]);
  const gateway = fake.gateway();
  const codes: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await gateway.generate(request([user]));
    assert.equal(result.ok, false);
    if (!result.ok) codes.push(result.error.code);
  }
  assert.deepEqual(codes, ['output_limit', 'permission', 'permission', 'invalid_response', 'invalid_response']);
});

test('provider errors are typed and never echo provider text', async () => {
  const fake = new FakeOpenAI([
    { status: 401, errorType: 'invalid_request_error' }, { status: 429, errorType: 'rate_limit_exceeded' },
    { status: 500, errorType: 'server_error' }, { status: 400, errorType: 'invalid_request_error' },
  ]);
  const gateway = fake.gateway();
  const seen: [string, boolean][] = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await gateway.generate(request([user]));
    assert.ok(!result.ok);
    assert.doesNotMatch(result.error.message, /sensitive provider text/);
    seen.push([result.error.code, result.error.retryable]);
  }
  assert.deepEqual(seen, [['authentication_required', false], ['rate_limited', true], ['transport', true], ['unsupported', false]]);
});

test('config requires an explicit model and key, validates effort and base URL', () => {
  const base = { OPENAI_API_KEY: 'secret-value', VIPER_OPENAI_MODEL: 'some-model' };
  assert.deepEqual(parseOpenAIModelConfig(base), { provider: 'openai', apiKey: 'secret-value', model: 'some-model', maxRetries: 0 });
  assert.equal(parseOpenAIModelConfig({ ...base, OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1' }).baseUrl, 'http://127.0.0.1:8080/v1');
  for (const [env, pattern] of [
    [{ OPENAI_API_KEY: 'k' }, /VIPER_OPENAI_MODEL is required/], [{ VIPER_OPENAI_MODEL: 'm' }, /OPENAI_API_KEY is required/],
    [{ ...base, VIPER_OPENAI_REASONING_EFFORT: 'huge' }, /REASONING_EFFORT/], [{ ...base, OPENAI_BASE_URL: 'http://api.example.com' }, /https/],
  ] as const) {
    assert.throws(() => parseOpenAIModelConfig(env), (error: Error) => pattern.test(error.message) && !error.message.includes('secret-value'));
  }
});

test('a function named like a clarification (clarify) is an ordinary tool call, never needs_input', async () => {
  const fake = new FakeOpenAI([{ toolCalls: [{ id: 'call_c', name: 'clarify', argumentFragments: ['{"question":"Which Ardi?"}'] }] }]);
  const result = await fake.gateway().generate(request([user]));
  assert.ok(result.ok && result.decision.kind === 'tool_calls');
  assert.deepEqual(result.decision.calls, [{ id: 'call_c', name: 'clarify', arguments: { question: 'Which Ardi?' } }]);
});

test('usage: automatic prefix-cache reads are reported separately; writes are not reported by the provider', async () => {
  const fake = new FakeOpenAI([{ text: ['ok'], usage: { prompt: 1200, completion: 5, cached: 1024 } }, { text: ['ok'] }]);
  const cached = await fake.gateway().generate(request([user]));
  assert.ok(cached.ok);
  assert.deepEqual(cached.usage, { source: 'provider', inputTokens: 1200, outputTokens: 5, totalTokens: 1205, cacheReadTokens: 1024 });
  const plain = await fake.gateway().generate(request([user]));
  assert.ok(plain.ok && !('cacheReadTokens' in plain.usage) && !('cacheWriteTokens' in plain.usage));
});
