export interface RunLimits {
  readonly maxTotalTokens: number;
  readonly maxSteps: number;
  /** Counts proposed calls, including validation/policy rejections; dispatches cannot exceed it. */
  readonly maxToolCalls: number;
  readonly maxDurationMs: number;
  readonly maxModelOutputBytes: number;
  readonly maxToolOutputBytes: number;
  readonly maxTotalOutputBytes: number;
  readonly maxRepeatedToolCalls: number;
  readonly maxCorrections: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = Object.freeze({
  maxTotalTokens: Number.MAX_SAFE_INTEGER,
  maxSteps: 32, maxToolCalls: 32, maxDurationMs: 120_000,
  maxModelOutputBytes: 262_144, maxToolOutputBytes: 262_144,
  maxTotalOutputBytes: 1_048_576, maxRepeatedToolCalls: 3, maxCorrections: 2,
});

export type BudgetReason = 'step_limit' | 'tool_call_limit' | 'model_output_limit'
  | 'tool_output_limit' | 'total_output_limit' | 'repetition_limit' | 'correction_limit' | 'context_input_limit' | 'tool_search_limit' | 'token_limit';
export type ExecutionStopReason = BudgetReason | 'cancelled' | 'deadline_exceeded' | 'unknown_outcome';

export class BudgetExceeded extends Error {
  constructor(readonly reason: BudgetReason) { super(reason); this.name = 'BudgetExceeded'; }
}

export function resolveRunLimits(input: Partial<RunLimits> = {}): RunLimits {
  const result = { ...DEFAULT_RUN_LIMITS, ...input };
  for (const [name, value] of Object.entries(result)) {
    if (!Object.hasOwn(DEFAULT_RUN_LIMITS, name)) throw new Error(`Unknown run limit: ${name}`);
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid run limit: ${name}`);
  }
  if (result.maxDurationMs > 2_147_483_647) throw new RangeError('Run duration exceeds timer range');
  return Object.freeze(result);
}
