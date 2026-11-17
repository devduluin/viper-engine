import { parseJsonObject } from '../messages/json.js';

export interface ModelUsage {
  readonly source: 'provider' | 'estimate' | 'unavailable';
  /** Whole prompt, cached and uncached together (budgets and the public API use this figure). */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  /** Part of inputTokens served from the provider prompt cache; absent when the provider does not say. */
  readonly cacheReadTokens?: number | null;
  /** Part of inputTokens written to the provider prompt cache; absent when the provider does not say. */
  readonly cacheWriteTokens?: number | null;
}

const COUNTS = ['inputTokens', 'outputTokens', 'totalTokens'] as const;
const CACHE = ['cacheReadTokens', 'cacheWriteTokens'] as const;

function count(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid token count');
  return value;
}

function cacheCounts(input: Readonly<Record<string, unknown>>, source: ModelUsage['source'], inputTokens: number | null) {
  const present = CACHE.filter(key => key in input);
  const values = Object.fromEntries(present.map(key => [key, count(input[key])])) as Partial<Record<(typeof CACHE)[number], number | null>>;
  if (source === 'unavailable' && present.some(key => values[key] !== null)) throw new Error('Unavailable usage must have null counts');
  const cached = (values.cacheReadTokens ?? 0) + (values.cacheWriteTokens ?? 0);
  if (inputTokens !== null && cached > inputTokens) throw new Error('Cache tokens exceed input tokens');
  return values;
}

const KNOWN = new Set<string>(['source', ...COUNTS, ...CACHE]);

function sourceOf(value: unknown): ModelUsage['source'] {
  if (value !== 'provider' && value !== 'estimate' && value !== 'unavailable') throw new Error('Invalid usage source');
  return value;
}

export function parseModelUsage(value: unknown): ModelUsage {
  const input = parseJsonObject(value);
  if (Object.keys(input).some(key => !KNOWN.has(key))) throw new Error('Unexpected usage field');
  const source = sourceOf(input['source']);
  const [inputTokens = null, outputTokens = null, totalTokens = null] = COUNTS.map(key => count(input[key]));
  if (source === 'unavailable' && [inputTokens, outputTokens, totalTokens].some(item => item !== null)) {
    throw new Error('Unavailable usage must have null counts');
  }
  return Object.freeze({ source, inputTokens, outputTokens, totalTokens, ...cacheCounts(input, source, inputTokens) });
}
