import type { Clock } from '../contracts/identity/ports.js';
import type { ModelCallOptions, ModelGateway, ModelRequest } from '../contracts/models/gateway.js';
import type { DeltaBus } from '../application/streaming/delta-bus.js';

/**
 * Wraps a streaming-capable gateway so its provisional text reaches live SSE clients as `message.delta`.
 * The run loop is untouched: deltas are published as a side effect of the call, the decision and the
 * durable events are exactly the same with or without listeners. Non-streaming gateways pass through.
 */
export function withDeltaPublishing(gateway: ModelGateway, bus: DeltaBus, clock: Clock): ModelGateway {
  if (!gateway.capabilities.streaming) return gateway;
  return Object.freeze({
    capabilities: gateway.capabilities,
    generate: (request: ModelRequest, options: ModelCallOptions = {}) => gateway.generate(request, {
      ...options,
      onEvent: async (event) => {
        await options.onEvent?.(event);
        if (event.type !== 'text_delta' || event.text === '' || bus.subscriberCount === 0) return;
        bus.publish({
          schemaVersion: 1, type: 'message.delta', conversationId: request.conversationId, runId: request.runId,
          stepId: request.stepId, modelCallId: request.modelCallId, messageId: request.modelCallId,
          occurredAt: clock.now(), delta: event.text.slice(0, 16_384),
        });
      },
    }),
  });
}
