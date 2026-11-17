import OpenAI from 'openai';
import { OpenAIModelGateway } from '../adapters/models/openai/gateway.js';
import type { OpenAIReasoningEffort } from '../adapters/models/openai/to-request.js';
import type { Clock } from '../contracts/identity/ports.js';

type Environment = Readonly<Record<string, string | undefined>>;

const EFFORTS: readonly OpenAIReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface OpenAIModelConfig {
  readonly provider: 'openai';
  /** Never logged or echoed; read only from the environment. */
  readonly apiKey: string;
  readonly model: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  /** Optional compatible endpoint; https required except loopback. */
  readonly baseUrl?: string;
  readonly maxRetries: number;
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${key} is required for the openai provider`);
  return value;
}

function baseUrlOf(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const url = new URL(raw.trim());
  if (url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('OPENAI_BASE_URL must not embed credentials or fragments');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('OPENAI_BASE_URL must use https');
  return url.toString();
}

function effortOf(raw: string | undefined): OpenAIReasoningEffort | undefined {
  const value = raw?.trim();
  if (value === undefined || value === '') return undefined;
  const found = EFFORTS.find(effort => effort === value);
  if (found === undefined) throw new Error(`VIPER_OPENAI_REASONING_EFFORT must be one of ${EFFORTS.join(', ')}`);
  return found;
}

/**
 * OPENAI_API_KEY, VIPER_OPENAI_MODEL (required: no guessed default), VIPER_OPENAI_REASONING_EFFORT
 * (optional), OPENAI_BASE_URL (optional), VIPER_MODEL_MAX_RETRIES (default 0).
 */
export function parseOpenAIModelConfig(env: Environment): OpenAIModelConfig {
  const model = required(env, 'VIPER_OPENAI_MODEL');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid VIPER_OPENAI_MODEL');
  const reasoningEffort = effortOf(env['VIPER_OPENAI_REASONING_EFFORT']);
  const retries = env['VIPER_MODEL_MAX_RETRIES']?.trim() || '0';
  if (!/^\d$/.test(retries)) throw new Error('VIPER_MODEL_MAX_RETRIES must be 0-9');
  const baseUrl = baseUrlOf(env['OPENAI_BASE_URL']);
  return Object.freeze({
    provider: 'openai', apiKey: required(env, 'OPENAI_API_KEY'), model, maxRetries: Number(retries),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }), ...(baseUrl === undefined ? {} : { baseUrl }),
  });
}

export function createOpenAIModelGateway(config: OpenAIModelConfig, clock: Clock): OpenAIModelGateway {
  const client = new OpenAI({
    apiKey: config.apiKey, maxRetries: config.maxRetries, ...(config.baseUrl === undefined ? {} : { baseURL: config.baseUrl }),
  });
  return new OpenAIModelGateway({
    api: client.chat.completions, clock,
    settings: config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
  });
}
