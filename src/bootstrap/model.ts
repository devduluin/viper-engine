import Anthropic from '@anthropic-ai/sdk';
import { AnthropicModelGateway } from '../adapters/models/anthropic/gateway.js';
import type { Clock } from '../contracts/identity/ports.js';
import type { AnthropicModelConfig } from './model-config.js';

/** Effort the user chose for a run (runs.effort); undefined = the configured default. */
export type RunEffortLookup = (runId: string) => Promise<'low' | 'medium' | 'high' | undefined>;

/** Reads runs.effort; hosts pass it to createConfiguredModelBinding so the composer's choice reaches the model. */
export function runEffortFromDatabase(pool: { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> }): RunEffortLookup {
  return async (runId) => {
    const result = await pool.query('SELECT effort FROM viper_engine.runs WHERE id = $1', [runId]);
    const value = (result.rows[0] as { effort?: unknown } | undefined)?.effort;
    return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
  };
}

export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

/** Composition root for the model provider; the key goes straight into the SDK client. */
export function createModelGateway(config: AnthropicModelConfig, clock: Clock = systemClock,
  runEffort?: RunEffortLookup): AnthropicModelGateway {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: config.maxRetries });
  return new AnthropicModelGateway({
    api: client.beta.messages, clock,
    ...(runEffort === undefined ? {} : { resolveEffort: (request: { readonly runId: string }) => runEffort(request.runId) }),
    settings: { effort: config.effort, fallbacks: config.fallbacks,
      ...(config.promptCache.enabled ? { promptCache: { ttl: config.promptCache.ttl } } : {}) },
  });
}
