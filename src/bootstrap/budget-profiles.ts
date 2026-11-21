import { DEFAULT_BUDGET_PROFILES, validateBudgetProfiles } from '../contracts/models/budget-profiles.js';
import type { BudgetMode, BudgetProfiles, ModeBudget } from '../contracts/models/budget-profiles.js';

/** Explicit environment map; never reads either source repo's env file. */
export function parseBudgetProfiles(env: Readonly<Record<string, string | undefined>>): BudgetProfiles {
  const value = (name: string, fallback: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new RangeError(`Invalid ${name}`);
    return Number(raw);
  };
  const mode = (name: BudgetMode): ModeBudget => {
    const prefix = `VIPER_RUN_${name.toUpperCase()}_`;
    const defaults = DEFAULT_BUDGET_PROFILES[name];
    return { maxTotalTokens: value(`${prefix}MAX_TOTAL_TOKENS`, defaults.maxTotalTokens),
      maxModelCalls: value(`${prefix}MAX_MODEL_CALLS`, defaults.maxModelCalls),
      maxToolCalls: value(`${prefix}MAX_TOOL_CALLS`, defaults.maxToolCalls),
      maxOutputTokens: value(`${prefix}MAX_OUTPUT_TOKENS`, defaults.maxOutputTokens),
      maxDurationMs: value(`${prefix}MAX_DURATION_MS`, defaults.maxDurationMs) };
  };
  return validateBudgetProfiles({ hardMaxTotalTokens: value('VIPER_RUN_HARD_MAX_TOTAL_TOKENS', DEFAULT_BUDGET_PROFILES.hardMaxTotalTokens),
    low: mode('low'), medium: mode('medium'), high: mode('high') });
}
