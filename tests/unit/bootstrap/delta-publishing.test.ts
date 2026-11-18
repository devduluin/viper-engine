import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeltaBus, type MessageDeltaFrame } from '../../../src/application/streaming/delta-bus.js';
import { withDeltaPublishing } from '../../../src/bootstrap/streaming-model.js';
import type { ModelCallOptions, ModelGateway, ModelRequest, ModelResult } from '../../../src/contracts/models/gateway.js';

const request = { conversationId: 'conversation-1', runId: 'run-1', stepId: 'step-1', modelCallId: 'model_call-1' } as unknown as ModelRequest;
const result = { ok: true, decision: { kind: 'final', content: [{ type: 'text', text: 'Halo dunia' }] }, usage: {} } as unknown as ModelResult;

function fakeGateway(streaming: boolean, seen: ModelCallOptions[]): ModelGateway {
  return {
    capabilities: { streaming } as ModelGateway['capabilities'],
    generate: async (_request, options = {}) => {
      seen.push(options);
      await options.onEvent?.({ type: 'text_delta', modelCallId: request.modelCallId, text: 'Halo ' });
      await options.onEvent?.({ type: 'text_delta', modelCallId: request.modelCallId, text: 'dunia' });
      return result;
    },
  };
}

test('deltas reach subscribers of that run only; the model result and the caller observer are unchanged', async () => {
  const bus = new DeltaBus(); const frames: MessageDeltaFrame[] = []; const other: MessageDeltaFrame[] = []; const observed: string[] = [];
  const stop = bus.subscribe('run-1', frame => frames.push(frame));
  bus.subscribe('run-2', frame => other.push(frame));
  const gateway = withDeltaPublishing(fakeGateway(true, []), bus, { now: () => 42 });
  const answer = await gateway.generate(request, { onEvent: event => { if (event.type === 'text_delta') observed.push(event.text); } });
  assert.equal(answer, result);
  assert.deepEqual(observed, ['Halo ', 'dunia']);
  assert.deepEqual(frames.map(frame => frame.delta), ['Halo ', 'dunia']);
  assert.deepEqual(frames[0], { schemaVersion: 1, type: 'message.delta', conversationId: 'conversation-1', runId: 'run-1',
    stepId: 'step-1', modelCallId: 'model_call-1', messageId: 'model_call-1', occurredAt: 42, delta: 'Halo ' });
  assert.equal(other.length, 0);
  stop();
  assert.equal(bus.subscriberCount, 1);
});

test('a throwing listener never breaks the run; non-streaming gateways pass through untouched', async () => {
  const bus = new DeltaBus();
  bus.subscribe('run-1', () => { throw new Error('socket closed'); });
  assert.equal(await withDeltaPublishing(fakeGateway(true, []), bus, { now: () => 1 }).generate(request), result);
  const seen: ModelCallOptions[] = [];
  const plain = fakeGateway(false, seen);
  assert.equal(withDeltaPublishing(plain, bus, { now: () => 1 }), plain);
});
