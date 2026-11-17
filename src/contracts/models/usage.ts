import { parseJsonObject } from '../messages/json.js';

export interface ModelUsage {
  readonly source: 'provider' | 'estimate' | 'unavailable';
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export function parseModelUsage(value: unknown): ModelUsage {
  const input = parseJsonObject(value);
  const keys = ['source', 'inputTokens', 'outputTokens', 'totalTokens'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unexpected usage field');
  const source = input['source'];
  if (source !== 'provider' && source !== 'estimate' && source !== 'unavailable') throw new Error('Invalid usage source');
  const counts = keys.slice(1).map(key => {
    const count = input[key];
    if (count === null) return null;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid token count');
    return count;
  });
  if (source === 'unavailable' && counts.some(count => count !== null)) throw new Error('Unavailable usage must have null counts');
  const [inputTokens, outputTokens, totalTokens] = counts;
  return Object.freeze({ source, inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null, totalTokens: totalTokens ?? null });
}
