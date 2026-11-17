import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatCompletion } from 'openai/resources/chat/completions/completions';
import { OpenAIModelGateway } from '../../../src/adapters/models/openai/gateway.js';
import type { OpenAIChatStream } from '../../../src/adapters/models/openai/gateway.js';
import { interpretCompletion, usageFrom } from '../../../src/adapters/models/openai/from-response.js';
import { parseOpenAIModelConfig } from '../../../src/bootstrap/openai-model.js';
import { modelRequest } from '../../support/anthropic/request.js';
import { FakeOpenAI } from '../../support/openai/fake-api.js';

test('deadline and cancellation bound a stream whose body never completes and abort it', async () => {
  for (const cancel of [false, true]) {
    let aborted = false;
    const stream: OpenAIChatStream = {
      async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
      finalChatCompletion: () => new Promise(() => {}), abort: () => { aborted = true; },
    };
    const gateway = new OpenAIModelGateway({ api: { stream: () => stream }, clock: { now: () => 1000 },
      settings: {}, requestTimeoutMs: 40 });
    const controller = new AbortController();
    if (cancel) setTimeout(() => controller.abort(), 10);
    const result = await gateway.generate(modelRequest(undefined, { model: 'test-model', deadlineAt: 1020 }), { signal: controller.signal });
    assert.ok(!result.ok && result.error.code === (cancel ? 'cancelled' : 'timeout'));
    assert.equal(aborted, true);
  }
});

test('a stalled usage observer shares the full operation deadline', async () => {
  const fake = new FakeOpenAI([{ text: ['Done'] }]);
  const gateway = new OpenAIModelGateway({ api: fake.client.chat.completions, clock: { now: () => 1000 },
    settings: {}, requestTimeoutMs: 40 });
  const result = await gateway.generate(modelRequest(undefined, { model: 'test-model' }), {
    onEvent: event => { if (event.type === 'usage') return new Promise(() => {}); },
  });
  assert.ok(!result.ok && result.error.code === 'timeout');
});

test('untrusted API error type cannot escape the safe error boundary', async () => {
  const fake = new FakeOpenAI([{ status: 400, errorType: 'PRIVATE_PROVIDER_TYPE' }]);
  const result = await fake.gateway().generate(modelRequest(undefined, { model: 'test-model' }));
  assert.ok(!result.ok);
  assert.doesNotMatch(result.error.message, /PRIVATE_PROVIDER_TYPE|sensitive provider/);
});

test('missing, unknown and inconsistent finish reasons never become executable decisions', () => {
  for (const finish of [null, 'unknown', 'function_call', 'tool_calls']) {
    const completion = { choices: [{ index: 0, finish_reason: finish,
      message: { role: 'assistant', content: 'Partial output', refusal: null } }] } as unknown as ChatCompletion;
    const result = interpretCompletion(completion);
    assert.ok(!result.ok && result.error.code === 'invalid_response');
  }
});

test('unsafe/inconsistent token counts fail closed; unavailable usage remains explicitly unknown', () => {
  for (const usage of [
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 5, total_tokens: Number.MAX_SAFE_INTEGER + 5 },
    { prompt_tokens: 5, completion_tokens: 5, total_tokens: 1 },
    { prompt_tokens: -1, completion_tokens: 5, total_tokens: 4 },
  ]) assert.throws(() => usageFrom(usage));
  assert.equal(usageFrom(undefined).source, 'unavailable');
});

test('configuration disables hidden retries and rejects credentials embedded in base URLs', () => {
  const env = { OPENAI_API_KEY: 'not-a-real-key', VIPER_OPENAI_MODEL: 'test-model' };
  assert.equal(parseOpenAIModelConfig(env).maxRetries, 0);
  assert.equal(parseOpenAIModelConfig({ ...env, VIPER_MODEL_MAX_RETRIES: '1' }).maxRetries, 1);
  for (const baseUrl of ['https://user:secret@example.test/v1', 'https://example.test/v1#fragment']) {
    assert.throws(() => parseOpenAIModelConfig({ ...env, OPENAI_BASE_URL: baseUrl }), /must not embed/);
  }
});
