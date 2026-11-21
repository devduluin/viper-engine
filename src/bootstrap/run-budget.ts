import type { ViperEngineOptions } from './engine-types.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import type { RunLimits } from '../agent/policies/limits.js';
import { validateBudgetProfiles } from '../contracts/models/budget-profiles.js';
import { runEffortFromDatabase } from './model.js';

/** Resolve once for a new run; durable execution preserves the selected limits thereafter. */
export function runBudgetSelector(pool: SqlPool, options: ViperEngineOptions, limits: RunLimits) {
  const profiles = options.budgetProfiles === undefined ? undefined : validateBudgetProfiles(options.budgetProfiles);
  const mode = options.defaultBudgetMode ?? 'medium';
  if (!['low', 'medium', 'high'].includes(mode)) throw new RangeError('Invalid default budget mode');
  const effort = runEffortFromDatabase(pool);
  const caps = Object.freeze({ ...options.limits });
  return async (id: string) => {
    if (profiles === undefined) return {};
    const profile = profiles[await effort(id) ?? mode];
    return { maxModelCalls: cap(profile.maxModelCalls, options.maxModelCalls),
      maxOutputTokens: cap(profile.maxOutputTokens, options.maxOutputTokens),
      limits: { ...limits, maxTotalTokens: cap(profile.maxTotalTokens, caps.maxTotalTokens),
        maxToolCalls: cap(profile.maxToolCalls, caps.maxToolCalls), maxDurationMs: cap(profile.maxDurationMs, caps.maxDurationMs) } };
  };
}
function cap(value: number, maximum: number | undefined) { return Math.min(value, maximum ?? value); }
