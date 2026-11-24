/** Resources are reserved atomically by the persistence layer before a child is queued. */
export interface AgentBudget {
  readonly tokens: number;
  readonly toolCalls: number;
  readonly durationMs: number;
}

export function allocateAgentBudget(remaining: AgentBudget, requested: AgentBudget, reserveFraction: number): AgentBudget {
  if (!Number.isFinite(reserveFraction) || reserveFraction < 0 || reserveFraction >= 1) throw new RangeError('Invalid parent reserve');
  if (!Object.values(remaining).every(value => Number.isSafeInteger(value) && value >= 0)
    || !Object.values(requested).every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError('Invalid agent budget');
  if (Object.values(requested).some(value => value === 0)) throw new RangeError('Agent budget must be positive');
  if (requested.tokens > Math.floor(remaining.tokens * (1 - reserveFraction))
    || requested.toolCalls > Math.floor(remaining.toolCalls * (1 - reserveFraction))
    || requested.durationMs > remaining.durationMs) throw new Error('AGENT_BUDGET_EXHAUSTED');
  return Object.freeze({ ...requested });
}
