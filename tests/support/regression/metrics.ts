import type { RunUsage } from '../../../src/contracts/models/run-usage.js';

/** Nearest-rank quantiles, no interpolation; small n is explicitly reported. */
export function quantile(values: readonly number[], fraction: number): number | null {
  if (fraction <= 0 || fraction > 1 || !Number.isFinite(fraction)) throw new RangeError('Quantile must be (0, 1]');
  if (values.length === 0) return null;
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid latency sample');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}
export function latency(values: readonly number[]) {
  return { samples: values.length, p50Ms: quantile(values, 0.5), p95Ms: quantile(values, 0.95), method: 'nearest_rank' };
}
export function usageTotals(values: readonly (RunUsage | undefined)[]) {
  const sum = (field: 'inputTokens' | 'outputTokens' | 'totalTokens') => values.reduce((total, usage) => {
    const tokens = usage?.[field]; const noCalls = usage?.modelCalls === 0;
    return { known: total.known + (tokens ?? 0), unknownTrials: total.unknownTrials + (tokens == null && !noCalls ? 1 : 0) };
  }, { known: 0, unknownTrials: 0 });
  return { modelCalls: values.reduce((count, usage) => count + (usage?.modelCalls ?? 0), 0),
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), totalTokens: sum('totalTokens'),
    provenance: 'scripted SDK counters or unavailable; not billed provider usage', billedCost: null };
}
