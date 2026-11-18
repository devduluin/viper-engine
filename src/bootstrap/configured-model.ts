import type { Clock } from '../contracts/identity/ports.js';
import type { ModelGateway } from '../contracts/models/gateway.js';
import { parseModelConfig } from './model-config.js';
import type { AnthropicModelConfig } from './model-config.js';
import { createModelGateway, type RunEffortLookup } from './model.js';
import { createOpenAIModelGateway, parseOpenAIModelConfig } from './openai-model.js';
import type { OpenAIModelConfig } from './openai-model.js';

export interface EngineModel {
  readonly provider: string;
  readonly model: string;
  readonly gateway: ModelGateway;
}

export type ConfiguredModel = AnthropicModelConfig | OpenAIModelConfig;

/** Explicit environment map only; this module never loads .env or chooses a new provider/model. */
export function parseConfiguredModelConfig(env: Readonly<Record<string, string | undefined>>): ConfiguredModel {
  const provider = env['VIPER_MODEL_PROVIDER']?.trim() || 'anthropic';
  if (provider === 'anthropic') return parseModelConfig(env);
  if (provider === 'openai') return parseOpenAIModelConfig(env);
  throw new Error('Unsupported model provider');
}

/** `runEffort` (Anthropic): per-run effort from the composer, e.g. runEffortFromDatabase(pool). OpenAI keeps its configured effort. */
export function createConfiguredModelBinding(config: ConfiguredModel, clock: Clock, runEffort?: RunEffortLookup): EngineModel {
  return Object.freeze({ provider: config.provider, model: config.model,
    gateway: config.provider === 'anthropic' ? createModelGateway(config, clock, runEffort) : createOpenAIModelGateway(config, clock) });
}
