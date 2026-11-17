/** Text estimate is approximate; byte limits also cover media/schema payloads. */
export interface ContextBudget {
  readonly windowTokens: number; readonly framingReserveTokens: number;
  readonly maxInputBytes: number; readonly maxSummaryBytes: number; readonly recentTurns: number;
}
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = Object.freeze({ windowTokens: 65536,
  framingReserveTokens: 2048, maxInputBytes: 1048576, maxSummaryBytes: 4096, recentTurns: 2 });

function assertBudgetEntries(budget: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(budget)) {
    if (!Object.hasOwn(DEFAULT_CONTEXT_BUDGET, key)) throw new RangeError('Invalid context budget');
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid context budget');
  }
}

function assertBudgetCeilings(budget: ContextBudget): void {
  const { windowTokens, maxInputBytes, maxSummaryBytes, recentTurns, framingReserveTokens } = budget;
  if (windowTokens > 10000000 || maxInputBytes > 16777216 || maxSummaryBytes < 1024 || maxSummaryBytes > 65536) throw new RangeError('Invalid context ceiling');
  if (recentTurns > 100 || framingReserveTokens >= windowTokens) throw new RangeError('Invalid context ceiling');
}

export function resolveContextBudget(input: Partial<ContextBudget> = {}): ContextBudget {
  const resolved = { ...DEFAULT_CONTEXT_BUDGET, ...input };
  assertBudgetEntries(resolved);
  assertBudgetCeilings(resolved);
  return Object.freeze(resolved);
}
