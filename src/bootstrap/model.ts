import Anthropic from '@anthropic-ai/sdk';
import { AnthropicModelGateway } from '../adapters/models/anthropic/gateway.js';
import type { Clock } from '../contracts/identity/ports.js';
import type { AnthropicModelConfig } from './model-config.js';

export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

/** Composition root for the model provider; the key goes straight into the SDK client. */
export function createModelGateway(config: AnthropicModelConfig, clock: Clock = systemClock): AnthropicModelGateway {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: config.maxRetries });
  return new AnthropicModelGateway({
    api: client.beta.messages, clock,
    settings: { effort: config.effort, fallbacks: config.fallbacks,
      ...(config.promptCache.enabled ? { promptCache: { ttl: config.promptCache.ttl } } : {}) },
  });
}
