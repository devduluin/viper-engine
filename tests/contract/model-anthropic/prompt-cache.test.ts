import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { ModelRequest } from '../../../src/contracts/models/gateway.js';
import { testScope } from '../../support/agent/setup.js';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';

const tools = [
  { name: 'inv__add', description: 'Add', inputSchema: { type: 'object', properties: { n: { type: 'number' } } } },
  { name: 'inv__lookup', description: 'Lookup', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];
const system = parseMessage({ id: 's', role: 'system', content: [{ type: 'text', text: 'Use tools.' }] });
const user = parseMessage({ id: 'u', role: 'user', content: [{ type: 'text', text: 'Stock of item-1?' }] });
const assistant = parseMessage({ id: 'a', role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'inv__lookup', arguments: { id: 'item-1' } }] });
const result = parseMessage({ id: 't', role: 'tool', toolCallId: 'c1', outcome: 'success', content: [{ type: 'json', data: { stock: 5 } }] });
const on = { effort: 'low', fallbacks: false, promptCache: { ttl: '5m' } } as const;

function request(messages: readonly Message[], extra: Partial<ModelRequest> = {}): ModelRequest {
  return {
    scope: testScope(), conversationId: parseId('conversation', 'c'), runId: parseId('run', 'r'), stepId: parseId('step', 's'),
    modelCallId: parseId('model_call', 'm'), model: 'claude-opus-5-5', maxOutputTokens: 1_000, messages, tools, ...extra,
  };
}
const text = (count: number) => Array.from({ length: count }, () => ({ blocks: [{ type: 'text' as const, text: 'ok' }] }));
const withoutMarkers = (value: unknown) => JSON.stringify(value, (key, item: unknown) => (key === 'cache_control' ? undefined : item));

test('prompt cache off (default): request is byte-identical to the uncached form, no cache_control anywhere', async () => {
  const fake = new FakeAnthropic(text(1));
  await fake.gateway({ effort: 'low', fallbacks: false }).generate(request([system, user]));
  const body = fake.bodies[0]!;
  assert.equal(body['system'], 'Use tools.');
  assert.doesNotMatch(JSON.stringify(body), /cache_control/);
});

test('prompt cache on: one explicit breakpoint closes tools+system, top-level automatic caching covers the tail', async () => {
  const fake = new FakeAnthropic(text(1));
  await fake.gateway(on).generate(request([system, user]));
  const body = fake.bodies[0]!;
  assert.deepEqual(body['system'], [{ type: 'text', text: 'Use tools.', cache_control: { type: 'ephemeral', ttl: '5m' } }]);
  assert.deepEqual(body['cache_control'], { type: 'ephemeral', ttl: '5m' });
  assert.equal((body['tools'] as { cache_control?: unknown }[]).some(tool => 'cache_control' in tool), false);
  assert.equal((JSON.stringify(body).match(/cache_control/g) ?? []).length, 2, 'two of the four allowed breakpoints');
});

test('prompt cache on without system text: the breakpoint goes on the last tool; 1h TTL is used on both markers', async () => {
  const fake = new FakeAnthropic(text(1));
  await fake.gateway({ ...on, promptCache: { ttl: '1h' } }).generate(request([user]));
  const body = fake.bodies[0]!;
  const sent = body['tools'] as { name: string; cache_control?: unknown }[];
  assert.equal('system' in body, false);
  assert.deepEqual(sent.map(tool => tool.cache_control ?? null), [null, { type: 'ephemeral', ttl: '1h' }]);
  assert.deepEqual(body['cache_control'], { type: 'ephemeral', ttl: '1h' });
});

test('consecutive calls of one run share an identical prefix: tools+system bytes equal, earlier messages unchanged', async () => {
  const fake = new FakeAnthropic(text(2));
  const gateway = fake.gateway(on);
  await gateway.generate(request([system, user]));
  await gateway.generate(request([system, user, assistant, result]));
  const [first, second] = [fake.bodies[0]!, fake.bodies[1]!];
  assert.equal(JSON.stringify(second['tools']), JSON.stringify(first['tools']));
  assert.equal(JSON.stringify(second['system']), JSON.stringify(first['system']));
  const [before, after] = [first['messages'] as unknown[], second['messages'] as unknown[]];
  assert.equal(withoutMarkers(after.slice(0, before.length)), withoutMarkers(before), 'history is appended, never rewritten');
});
