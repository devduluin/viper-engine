export type BudgetMode = 'low' | 'medium' | 'high';
export interface ModeBudget {
  readonly maxTotalTokens: number; readonly maxModelCalls: number; readonly maxToolCalls: number;
  readonly maxOutputTokens: number; readonly maxDurationMs: number;
}
export interface BudgetProfiles { readonly hardMaxTotalTokens: number; readonly low: ModeBudget; readonly medium: ModeBudget; readonly high: ModeBudget }
const profile = (maxTotalTokens: number, maxModelCalls: number, maxToolCalls: number, maxOutputTokens: number, maxDurationMs: number): ModeBudget =>
  Object.freeze({ maxTotalTokens, maxModelCalls, maxToolCalls, maxOutputTokens, maxDurationMs });
export const DEFAULT_BUDGET_PROFILES: BudgetProfiles = Object.freeze({ hardMaxTotalTokens: 200000,
  low: profile(30000, 6, 12, 1024, 60000), medium: profile(100000, 12, 32, 2048, 180000), high: profile(200000, 20, 64, 4096, 300000) });

export function validateBudgetProfiles(input: BudgetProfiles): BudgetProfiles {
  positive(input.hardMaxTotalTokens);
  const copy = (mode: BudgetMode): ModeBudget => {
    const selected = input[mode];
    for (const key of ['maxTotalTokens', 'maxModelCalls', 'maxToolCalls', 'maxOutputTokens', 'maxDurationMs'] as const) positive(selected[key]);
    if (selected.maxDurationMs > 2147483647) throw new RangeError('Mode budget duration exceeds timer range');
    if (selected.maxOutputTokens > selected.maxTotalTokens) throw new RangeError('Mode output exceeds token budget');
    return Object.freeze({ ...selected, maxTotalTokens: Math.min(selected.maxTotalTokens, input.hardMaxTotalTokens) });
  };
  return Object.freeze({ hardMaxTotalTokens: input.hardMaxTotalTokens, low: copy('low'), medium: copy('medium'), high: copy('high') });
}
function positive(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid mode budget');
}
