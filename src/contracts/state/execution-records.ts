import type { ModelCallId, RunId, StepId, ToolCallId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { ModelUsage } from '../models/usage.js';
import type { LeaseToken } from './leases.js';
import type { StateResult } from './result.js';
import type { NewRunEvent } from './events.js';

export type StepDecisionKind = 'final' | 'tool_calls' | 'needs_input';
export type ModelCallOutcome = 'succeeded' | 'failed' | 'cancelled';
export type AttemptResultKind = 'succeeded' | 'failed' | 'unknown' | 'retry_wait';

/** One dispatch of one tool call; inserted with the `dispatching` transition, never deleted. */
export interface ToolCallAttempt {
  readonly runId: RunId;
  readonly toolCallId: ToolCallId;
  readonly attempt: number;
  readonly workerId?: string;
  readonly fence?: number;
  readonly dispatchedAt: number;
  readonly settledAt?: number;
  readonly resultKind?: AttemptResultKind;
}

interface Leased {
  readonly at: number;
  /** Required when a durable driver writes; absent for in-process/offline callers. */
  readonly lease?: LeaseToken;
}

export interface StepStart extends Leased {
  readonly events?: readonly NewRunEvent[];
  readonly runId: RunId;
  readonly stepId: StepId;
  /** 1-based, gap-free per run. */
  readonly stepIndex: number;
}

export interface ModelCallStart extends Leased {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly modelCallId: ModelCallId;
  readonly attempt: number;
  readonly provider: string;
  readonly model: string;
}

export interface ModelCallFinish extends Leased {
  readonly runId: RunId;
  readonly modelCallId: ModelCallId;
  readonly outcome: ModelCallOutcome;
  /** Required iff outcome is `failed`; a sanitized code, never provider text. */
  readonly failureCode?: string;
  readonly usage: ModelUsage;
}

/** Step and model-call audit records (usage, outcome); no prompts, outputs or hidden reasoning. */
export interface ExecutionLedger {
  startStep(scope: TrustedScope, input: StepStart): Promise<StateResult<{ readonly stepId: StepId }>>;
  finishStep(scope: TrustedScope, input: Leased & { readonly runId: RunId; readonly stepId: StepId; readonly decision: StepDecisionKind }): Promise<StateResult<{ readonly stepId: StepId }>>;
  startModelCall(scope: TrustedScope, input: ModelCallStart): Promise<StateResult<{ readonly modelCallId: ModelCallId }>>;
  finishModelCall(scope: TrustedScope, input: ModelCallFinish): Promise<StateResult<{ readonly modelCallId: ModelCallId }>>;
  listToolCallAttempts(scope: TrustedScope, runId: RunId, toolCallId: ToolCallId): Promise<StateResult<readonly ToolCallAttempt[]>>;
}
