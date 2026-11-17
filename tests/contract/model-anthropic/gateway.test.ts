import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { ModelRequest, ModelStreamEvent } from '../../../src/contracts/models/gateway.js';
import { testScope } from '../../support/agent/setup.js';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';

const tool = { name: 'inv__lookup', description: 'Lookup', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } };
const system = parseMessage({ id: 's', role: 'system', content: [{ type: 'text', text: 'Use tools.' }] });
const user = parseMessage({ id: 'u', role: 'user', content: [{ type: 'text', text: 'Stock of item-1?' }] });

function request(messages: readonly Message[], extra: Partial<ModelRequest> = {}): ModelRequest {
  return {
    scope: testScope(), conversationId: parseId('conversation', 'c'), runId: parseId('run', 'r'), stepId: parseId('step', 's'),
    modelCallId: parseId('model_call', 'm'), model: 'claude-opus-5-5', maxOutputTokens: 1_000, messages, tools: [tool], ...extra,
  };
}

test('request: system prompt, tools, adaptive thinking with drop_block, effort and fallbacks', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'text', text: 'hi' }] }, { blocks: [{ type: 'text', text: 'hi' }] }]);
  await fake.gateway({ effort: 'high', fallbacks: true }).generate(request([system, user]));
  const body = fake.bodies[0]!;
  assert.equal(body['system'], 'Use tools.');
  assert.deepEqual(body['messages'], [{ role: 'user', content: [{ type: 'text', text: 'Stock of item-1?' }] }]);
  assert.deepEqual(body['tools'], [{ name: 'inv__lookup', description: 'Lookup', input_schema: tool.inputSchema }]);
  assert.deepEqual(body['thinking'], { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(body['output_config'], { effort: 'high' });
  assert.equal(body['fallbacks'], 'default');
  assert.equal(body['stream'], true);
  assert.match(fake.headers[0]!.get('anthropic-beta') ?? '', /thinking-binding-controls-2026-08-01.*server-side-fallback-2026-07-01/);
  await fake.gateway().generate(request([user], { model: 'claude-haiku-5-5' }));
  assert.equal('fallbacks' in fake.bodies[1]!, false);
  assert.doesNotMatch(fake.headers[1]!.get('anthropic-beta') ?? '', /server-side-fallback/);
});

test('tool_use becomes a tool_calls decision; usage includes cache reads and writes', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'inv__lookup', input: { id: 'item-1' } }],
    usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 7 } }]);
  const result = await fake.gateway().generate(request([system, user]));
  assert.ok(result.ok && result.decision.kind === 'tool_calls');
  assert.deepEqual(result.decision.calls, [{ id: 'toolu_1', name: 'inv__lookup', arguments: { id: 'item-1' } }]);
  assert.deepEqual(result.decision.content, [{ type: 'text', text: 'Checking.' }]);
  assert.deepEqual(result.usage, { source: 'provider', inputTokens: 157, outputTokens: 20, totalTokens: 177 });
});

test('history: one user message per batch of results, is_error for error/unknown, JSON as text', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'text', text: 'Done' }] }]);
  const assistant = parseMessage({ id: 'a', role: 'assistant', content: [], toolCalls: [
    { id: 'c1', name: 'inv__lookup', arguments: { id: 'a' } }, { id: 'c2', name: 'inv__lookup', arguments: { id: 'b' } }] });
  const ok = parseMessage({ id: 't1', role: 'tool', toolCallId: 'c1', outcome: 'success', content: [{ type: 'json', data: { stock: 5 } }] });
  const unknown = parseMessage({ id: 't2', role: 'tool', toolCallId: 'c2', outcome: 'unknown', content: [] });
  const result = await fake.gateway().generate(request([user, assistant, ok, unknown]));
  assert.ok(result.ok && result.decision.kind === 'final');
  assert.deepEqual((fake.bodies[0]!['messages'] as unknown[]).slice(1), [
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'c1', name: 'inv__lookup', input: { id: 'a' } },
      { type: 'tool_use', id: 'c2', name: 'inv__lookup', input: { id: 'b' } }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'c1', is_error: false, content: [{ type: 'text', text: '{"stock":5}' }] },
      { type: 'tool_result', tool_use_id: 'c2', is_error: true }] },
  ]);
});

test('thinking blocks from a previous turn are replayed verbatim for that assistant turn', async () => {
  const fake = new FakeAnthropic([
    { blocks: [{ type: 'thinking', thinking: '', signature: 'sig-abc' }, { type: 'tool_use', id: 'toolu_9', name: 'inv__lookup', input: { id: 'x' } }] },
    { blocks: [{ type: 'text', text: 'Five.' }] },
  ]);
  const gateway = fake.gateway();
  const first = await gateway.generate(request([user]));
  assert.ok(first.ok && first.decision.kind === 'tool_calls');
  const assistant = parseMessage({ id: 'a', role: 'assistant', content: first.decision.content, toolCalls: first.decision.calls });
  const result = parseMessage({ id: 't', role: 'tool', toolCallId: 'toolu_9', outcome: 'success', content: [{ type: 'text', text: '5' }] });
  await gateway.generate(request([user, assistant, result]));
  const replayed = (fake.bodies[1]!['messages'] as { content: { type: string; signature?: string }[] }[])[1]!;
  assert.deepEqual(replayed.content.map(block => block.type), ['thinking', 'tool_use']);
  assert.equal(replayed.content[0]?.signature, 'sig-abc');
});

test('streaming relays text and tool argument deltas with the tool call ID, then usage', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 'toolu_2', name: 'inv__lookup', input: { id: 'q' } }] }]);
  const events: ModelStreamEvent[] = [];
  const result = await fake.gateway().generate(request([user]), { onEvent: async event => { events.push(event); } });
  assert.ok(result.ok);
  assert.deepEqual(events.map(event => event.type), ['text_delta', 'tool_call_delta', 'usage']);
  assert.deepEqual(events[1], { type: 'tool_call_delta', modelCallId: 'm', toolCallId: 'toolu_2', argumentsDelta: '{"id":"q"}' });
});

test('refusal, truncation and empty output are failures, never executable decisions', async () => {
  const fake = new FakeAnthropic([
    { blocks: [], stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'cyber', explanation: null } },
    { blocks: [{ type: 'tool_use', id: 'toolu_3', name: 'inv__lookup', input: { id: 'x' } }], stopReason: 'max_tokens' },
    { blocks: [] },
    { blocks: [{ type: 'tool_use', id: 'toolu_4', name: 'inv__lookup', input: 'not-an-object' }] },
  ]);
  const gateway = fake.gateway();
  const codes = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await gateway.generate(request([user]));
    assert.equal(result.ok, false);
    if (!result.ok) codes.push([result.error.code, result.error.message]);
  }
  assert.deepEqual(codes.map(([code]) => code), ['permission', 'output_limit', 'invalid_response', 'invalid_response']);
  assert.equal(codes[0]?.[1], 'Model declined the request');
});

test('provider errors map to typed failures without echoing provider text; abort is cancelled', async () => {
  const fake = new FakeAnthropic([
    { status: 401, errorType: 'authentication_error' }, { status: 429, errorType: 'rate_limit_error' },
    { status: 529, errorType: 'overloaded_error' }, { status: 400, errorType: 'invalid_request_error' }, 'hang',
  ]);
  const gateway = fake.gateway();
  const failures = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await gateway.generate(request([user]));
    assert.ok(!result.ok);
    failures.push([result.error.code, result.error.retryable]);
    assert.doesNotMatch(result.error.message, /sensitive provider text/);
    assert.equal(result.usage.source, 'unavailable');
  }
  assert.deepEqual(failures, [['authentication_required', false], ['rate_limited', true], ['transport', true], ['unsupported', false]]);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const aborted = await gateway.generate(request([user]), { signal: controller.signal });
  assert.ok(!aborted.ok && aborted.error.code === 'cancelled');
});

test('fallback list holds only current models (no retired Claude 3.x ids)', async () => {
  const { FALLBACK_MODELS } = await import('../../../src/adapters/models/anthropic/to-request.js');
  assert.ok(FALLBACK_MODELS.has('claude-opus-5-5'));
  assert.deepEqual([...FALLBACK_MODELS].filter(model => model.startsWith('claude-3')), []);
});

test('a tool named like a clarification (ask_user) is an ordinary tool call, never needs_input', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'tool_use', id: 'toolu_2', name: 'ask_user', input: { question: 'Which Ardi?' } }] }]);
  const result = await fake.gateway().generate(request([user]));
  assert.ok(result.ok && result.decision.kind === 'tool_calls');
  assert.deepEqual(result.decision.calls, [{ id: 'toolu_2', name: 'ask_user', arguments: { question: 'Which Ardi?' } }]);
});
