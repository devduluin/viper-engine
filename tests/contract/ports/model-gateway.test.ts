import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { ModelGateway, ModelStreamEvent } from '../../../src/contracts/models/gateway.js';
import { parseModelDecision } from '../../../src/contracts/models/decision.js';
import { parseModelUsage } from '../../../src/contracts/models/usage.js';
import { assertModelCallOptions, assertModelRequest } from '../../../src/contracts/models/request-validation.js';
import { modelCapabilities, modelRequest } from './fixtures.js';

test('a provider-free gateway preserves context, cancellation and awaited stream events', async () => {
  const request = modelRequest();
  const controller = new AbortController();
  const order: string[] = [];
  const events: ModelStreamEvent[] = [];
  const gateway: ModelGateway = {
    capabilities: modelCapabilities,
    async generate(input, options) {
      assertModelRequest(input, this.capabilities, 0);
      assertModelCallOptions(this.capabilities, options);
      assert.equal(input.scope, request.scope);
      assert.equal(options?.signal, controller.signal);
      await options?.onEvent?.({
        type: 'tool_call_delta', modelCallId: input.modelCallId,
        toolCallId: parseId('tool_call', 'call-1'), argumentsDelta: '{"id":',
      });
      order.push('completed');
      return {
        ok: true,
        decision: parseModelDecision({ kind: 'tool_calls', calls: [{ id: 'call-1', name: 'inventory_lookup', arguments: { id: 'item-1' } }] }),
        usage: parseModelUsage({ source: 'provider', inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      };
    },
  };
  const result = await gateway.generate(request, {
    signal: controller.signal,
    onEvent: async event => { events.push(event); await Promise.resolve(); order.push('consumer-ready'); },
  });
  assert.equal(events[0]?.modelCallId, request.modelCallId);
  assert.deepEqual(order, ['consumer-ready', 'completed']);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.decision.kind, 'tool_calls');
});

test('typed failures do not turn an incomplete provider reply into a final action', async () => {
  const gateway: ModelGateway = {
    capabilities: modelCapabilities,
    async generate() {
      return {
        ok: false, error: { code: 'output_limit', message: 'Reply truncated', retryable: false },
        usage: parseModelUsage({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null }),
      };
    },
  };
  const result = await gateway.generate(modelRequest());
  assert.equal(result.ok, false);
  assert.equal('decision' in result, false);
  if (!result.ok) assert.equal(result.error.code, 'output_limit');
});
