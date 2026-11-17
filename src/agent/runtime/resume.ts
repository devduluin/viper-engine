import type { ToolCall } from '../../contracts/messages/message.js';
import { BudgetExceeded } from '../policies/limits.js';
import { RunInterrupted } from '../policies/control.js';
import type { StepContext } from './model-step.js';
import { driveAgentLoop, handleRuntimeDecision, snapshotLoopResult } from './run-loop.js';
import { guardedStop } from './stops.js';
import type { RunLoopResult, RunStop } from './types.js';

/** Executes only unanswered server-owned calls; does not ask the model to regenerate proposals. */
export async function resumeAgentCalls(context: StepContext, calls: readonly ToolCall[]): Promise<RunLoopResult> {
  let stop: RunStop | undefined;
  try { stop = await handleRuntimeDecision(context, { kind: 'tool_calls', calls, content: [] }); } catch (error) {
    if (!(error instanceof BudgetExceeded || error instanceof RunInterrupted)) throw error;
    stop = guardedStop(error.reason, context.state.reports);
  }
  if (stop === undefined) return driveAgentLoop(context);
  await context.emit({ type: 'run_stopped', status: stop.status, reason: stop.reason });
  return snapshotLoopResult(context, stop);
}
