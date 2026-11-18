import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicModelGateway } from '../../../src/adapters/models/anthropic/gateway.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { ModelRequest } from '../../../src/contracts/models/gateway.js';
import { testScope } from '../../support/agent/setup.js';
import { TestClock } from '../../support/agent/identity.js';
import { FakeAnthropic } from '../../support/anthropic/fake-api.js';

const user = parseMessage({ id: 'u', role: 'user', content: [{ type: 'text', text: 'Halo' }] });
const request = (runId: string): ModelRequest => ({
  scope: testScope(), conversationId: parseId('conversation', 'c'), runId: parseId('run', runId), stepId: parseId('step', 's'),
  modelCallId: parseId('model_call', 'm'), model: 'claude-opus-5-5', maxOutputTokens: 1_000, messages: [user], tools: [],
});
const effortOf = (body: Record<string, unknown>) => (body['output_config'] as { effort?: string }).effort;

test('per-run effort overrides the configured effort; unknown runs and lookup failures keep the default', async () => {
  const fake = new FakeAnthropic(Array.from({ length: 3 }, () => ({ blocks: [{ type: 'text' as const, text: 'ok' }] })));
  const chosen: Record<string, 'low' | 'high'> = { fast: 'low', deep: 'high' };
  const gateway = new AnthropicModelGateway({ api: fake.client.beta.messages, clock: new TestClock(Date.now()),
    settings: { effort: 'medium', fallbacks: false },
    resolveEffort: async (req) => { if (req.runId === 'broken') throw new Error('db down'); return chosen[req.runId]; } });
  await gateway.generate(request('deep'));
  await gateway.generate(request('other'));
  await gateway.generate(request('broken'));
  assert.deepEqual(fake.bodies.map(effortOf), ['high', 'medium', 'medium']);
});
