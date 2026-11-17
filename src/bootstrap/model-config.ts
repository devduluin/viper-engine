type Environment = Readonly<Record<string, string | undefined>>;

export type ModelEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface AnthropicModelConfig {
  readonly provider: 'anthropic';
  /** Never logged or echoed; read only from the environment. */
  readonly apiKey: string;
  readonly model: string;
  readonly effort: ModelEffort;
  readonly fallbacks: boolean;
  readonly maxRetries: number;
  /** VIPER_MODEL_PROMPT_CACHE: off (default), 5m or 1h. */
  readonly promptCache: 'off' | '5m' | '1h';
}

function effortOf(raw: string | undefined): ModelEffort {
  const value = raw?.trim() || 'medium';
  const found = EFFORTS.find(effort => effort === value);
  if (found === undefined) throw new Error(`VIPER_MODEL_EFFORT must be one of ${EFFORTS.join(', ')}`);
  return found;
}

function booleanOf(raw: string | undefined, key: string, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
  return value === 'true';
}

function promptCacheOf(raw: string | undefined): AnthropicModelConfig['promptCache'] {
  const value = raw?.trim().toLowerCase() || 'off';
  if (value !== 'off' && value !== '5m' && value !== '1h') throw new Error('VIPER_MODEL_PROMPT_CACHE must be off, 5m or 1h');
  return value;
}

function text(env: Environment, key: string, fallback?: string): string {
  const value = env[key]?.trim() || fallback;
  if (value === undefined || value.length === 0) throw new Error(`${key} is required for the anthropic provider`);
  return value;
}

/**
 * VIPER_MODEL_PROVIDER (anthropic), ANTHROPIC_API_KEY, VIPER_MODEL (default claude-opus-5-5),
 * VIPER_MODEL_EFFORT (default medium), VIPER_MODEL_FALLBACKS (default true), VIPER_MODEL_MAX_RETRIES,
 * VIPER_MODEL_PROMPT_CACHE (off | 5m | 1h, default off).
 */
export function parseModelConfig(env: Environment): AnthropicModelConfig {
  const provider = text(env, 'VIPER_MODEL_PROVIDER', 'anthropic');
  if (provider !== 'anthropic') throw new Error(`Unsupported VIPER_MODEL_PROVIDER: ${provider}`);
  const model = text(env, 'VIPER_MODEL', 'claude-opus-5-5');
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(model)) throw new Error('Invalid VIPER_MODEL');
  const retries = text(env, 'VIPER_MODEL_MAX_RETRIES', '0');
  if (!/^\d$/.test(retries)) throw new Error('VIPER_MODEL_MAX_RETRIES must be 0-9');
  return Object.freeze({
    provider: 'anthropic', apiKey: text(env, 'ANTHROPIC_API_KEY'), model, effort: effortOf(env['VIPER_MODEL_EFFORT']),
    fallbacks: booleanOf(env['VIPER_MODEL_FALLBACKS'], 'VIPER_MODEL_FALLBACKS', true), maxRetries: Number(retries),
    promptCache: promptCacheOf(env['VIPER_MODEL_PROMPT_CACHE']),
  });
}
