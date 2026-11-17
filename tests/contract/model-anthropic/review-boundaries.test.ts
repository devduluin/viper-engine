import assert from 'node:assert/strict';
import test from 'node:test';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { AnthropicModelGateway } from '../../../src/adapters/models/anthropic/gateway.js';
import type { AnthropicStream } from '../../../src/adapters/models/anthropic/gateway.js';
import { AssistantReplayCache } from '../../../src/adapters/models/anthropic/replay-cache.js';
import { testScope } from '../../support/agent/setup.js';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';
import { modelRequest, modelUser } from '../../support/anthropic/request.js';

test('thinking replay cannot cross actor, app, tenant, conversation, run, model or history prefix', async () => {
  const variations = [
    { scope: testScope('other') }, { scope: testScope('actor-a', 'other') }, { scope: testScope('actor-a', 'app-a', 'tenant') },
    { conversationId: parseId('conversation', 'other') }, { runId: parseId('run', 'other') }, { model: 'claude-sonnet-5-5' },
  ];
  for (const variant of [...variations, {}]) {
    const fake = new FakeAnthropic([
      { blocks: [{ type: 'thinking', thinking: 'PRIVATE_CONTEXT_A', signature: 'private-sig' }, { type: 'text', text: 'Common answer' }] },
      { blocks: [{ type: 'text', text: 'Done' }] },
    ]);
    const gateway = fake.gateway();
    assert.equal((await gateway.generate(modelRequest())).ok, true);
    const assistant = parseMessage({ id: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Common answer' }] });
    const follow = parseMessage({ id: 'follow', role: 'user', content: [{ type: 'text', text: 'Continue' }] });
    const prefix = Object.keys(variant).length === 0 ? parseMessage({ ...modelUser, content: [{ type: 'text', text: 'Different prefix' }] }) : modelUser;
    assert.equal((await gateway.generate(modelRequest([prefix, assistant, follow], variant))).ok, true);
    assert.doesNotMatch(JSON.stringify(fake.bodies[1]), /PRIVATE_CONTEXT_A|private-sig/);
  }
});

test('replay is deeply immutable and bounded by aggregate bytes as well as entry count', () => {
  const cache = new AssistantReplayCache(10, 100);
  const blocks: BetaContentBlock[] = [{ type: 'thinking', thinking: 'a', signature: 's' }];
  cache.remember('a', blocks);
  blocks[0] = { type: 'thinking', thinking: 'changed', signature: 's' };
  assert.equal(cache.recall('a')?.[0]?.type, 'thinking');
  assert.equal(Object.isFrozen(cache.recall('a')?.[0]), true);
  cache.remember('b', [{ type: 'thinking', thinking: 'b', signature: 's' }]);
  assert.equal(cache.size, 1);
  assert.equal(cache.recall('a'), undefined);
  cache.remember('huge', [{ type: 'thinking', thinking: 'x'.repeat(1000), signature: 's' }]);
  assert.equal(cache.recall('huge'), undefined);
});

test('adapter deadline and abort bound streams even when headers arrived and the body never ends', async () => {
  for (const cancel of [false, true]) {
    let aborted = false;
    const stream: AnthropicStream = {
      async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
      finalMessage: () => new Promise(() => {}), abort: () => { aborted = true; },
    };
    const gateway = new AnthropicModelGateway({ api: { stream: () => stream }, clock: { now: () => 1000 },
      settings: { effort: 'low', fallbacks: false }, requestTimeoutMs: 40 });
    const controller = new AbortController();
    if (cancel) setTimeout(() => controller.abort(), 10);
    const result = await gateway.generate(modelRequest(undefined, { deadlineAt: 1020 }), { signal: controller.signal });
    assert.ok(!result.ok);
    assert.equal(result.error.code, cancel ? 'cancelled' : 'timeout');
    assert.equal(aborted, true);
  }
});

test('provider-controlled error type and refusal category cannot escape through safe failure messages', async () => {
  const fake = new FakeAnthropic([
    { status: 400, errorType: 'PRIVATE_PROVIDER_TYPE' },
    { blocks: [], stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'PRIVATE_CATEGORY', explanation: 'PRIVATE_EXPLANATION' } },
  ]);
  const gateway = fake.gateway();
  for (let index = 0; index < 2; index += 1) {
    const result = await gateway.generate(modelRequest());
    assert.ok(!result.ok);
    assert.doesNotMatch(result.error.message, /PRIVATE_|sensitive provider/);
  }
});

test('a stalled usage observer cannot keep a completed model call alive beyond its deadline', async () => {
  const fake = new FakeAnthropic([{ blocks: [{ type: 'text', text: 'Done' }] }]);
  const gateway = new AnthropicModelGateway({ api: fake.client.beta.messages, clock: { now: () => 1000 },
    settings: { effort: 'low', fallbacks: false }, requestTimeoutMs: 40 });
  const result = await gateway.generate(modelRequest(), { onEvent: event => {
    if (event.type === 'usage') return new Promise(() => {});
  } });
  assert.ok(!result.ok && result.error.code === 'timeout');
});

test('missing/unrecognized stop reason and unsafe provider usage are never executable', async () => {
  const fake = new FakeAnthropic([
    { blocks: [{ type: 'text', text: 'Partial reply' }], stopReason: 'unrecognized' },
    { blocks: [{ type: 'text', text: 'reply' }], usage: { input: Number.MAX_SAFE_INTEGER, output: 5 } },
  ]);
  for (let index = 0; index < 2; index += 1) assert.equal((await fake.gateway().generate(modelRequest())).ok, false);
});
