import { latency } from '../regression/metrics.js';
import type { ComparisonTrial } from './types.js';

function validateBootstrap(differences: readonly number[], seed: number, resamples: number) {
  if (differences.some(value => !Number.isFinite(value) || Math.abs(value) > 1)) throw new Error('Invalid paired task difference');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid bootstrap seed');
  if (!Number.isSafeInteger(resamples) || resamples < 100 || resamples > 20000) throw new Error('Invalid bootstrap count');
}
/** Resample paired task differences, never treat repeated trials as independent tasks. */
export function pairedInterval(differences: readonly number[], seed = 17017, resamples = 5000) {
  validateBootstrap(differences, seed, resamples);
  if (differences.length < 2) return null;
  let state = seed >>> 0; const samples: number[] = [];
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  for (let sample = 0; sample < resamples; sample++) {
    let total = 0;
    for (let i = 0; i < differences.length; i++) total += differences[Math.floor(random() * differences.length)]!;
    samples.push(total / differences.length);
  }
  samples.sort((a, b) => a - b);
  return { lower: samples[Math.ceil(resamples * 0.025) - 1]!, upper: samples[Math.ceil(resamples * 0.975) - 1]!,
    level: 0.95, method: 'paired_task_percentile_bootstrap', seed, resamples, independentTasks: differences.length };
}
export function trialMetrics(trials: readonly ComparisonTrial[]) {
  const passes = trials.filter(trial => trial.passed).length;
  const billed = trials.length > 0 && trials.every(trial => trial.costProvenance === 'billed' && trial.costUsd !== null);
  const cost = billed ? trials.reduce((sum, trial) => sum + (trial.costUsd ?? 0), 0) : null;
  return { trials: trials.length, passes, rubricPassRate: trials.length === 0 ? null : passes / trials.length,
    criticalFailures: trials.filter(trial => trial.criticalFailure).length, latency: latency(trials.map(trial => trial.latencyMs)),
    modelCalls: trials.reduce((sum, trial) => sum + trial.modelCalls, 0), toolCalls: trials.reduce((sum, trial) => sum + trial.toolCalls, 0),
    billedCostUsd: cost, billedCostPerPassingTrialUsd: cost !== null && passes > 0 ? cost / passes : null };
}
export function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
}
