import type { Message } from '../../contracts/messages/message.js';
import type { ModelDecision } from '../../contracts/models/decision.js';
import { executeCalls } from '../execution/execute-calls.js';
import type { StepContext } from './model-step.js';
import { requestDecision } from './model-step.js';
import { finalAnswerStop } from './outcome.js';
import { RunInterrupted } from '../policies/control.js';
import { BudgetExceeded } from '../policies/limits.js';
import { createLoopContext } from './context.js';
import { guardedStop } from './stops.js';
import type { RunLoopDependencies, RunLoopInput, RunLoopResult, RunStop } from './types.js';
import type { ToolCallReport } from '../execution/dispatch.js';
import { discoverTools } from './discovery.js';
import { runClientTools } from './client-tools.js';
import { runMemoryTools } from './memory-tools.js';
import { limitNotice, recoverModelFailure, settleRecovery } from './recovery.js';

/**
 * Model -> validated MCP calls -> normalized results -> model, until a final answer, a pause,
 * a failure or cancellation. Orchestration only: context, planning, dispatch and outcome
 * classification live in narrow modules. Durability is the event sink's job (P04).
 */
export async function runAgentLoop(input: RunLoopInput, deps: RunLoopDependencies): Promise<RunLoopResult> {
  const context = createLoopContext(input, deps);
  try { return await driveAgentLoop(context); } finally { context.control.close(); }
}

export async function driveAgentLoop(context: StepContext): Promise<RunLoopResult> {
  for (;;) {
    const stop = await guardedStep(context);
    if (stop !== undefined) {
      await context.emit({ type: 'run_stopped', status: stop.status, reason: stop.reason });
      return snapshotLoopResult(context, stop);
    }
  }
}

export function snapshotLoopResult(context: StepContext, stop: RunStop): RunLoopResult {
  const { state } = context;
  return Object.freeze({ ...stop, messages: Object.freeze([...state.appended]),
    toolCalls: Object.freeze([...state.reports]), modelCalls: state.modelCalls, budget: context.budget.snapshot() });
}

async function guardedStep(context: StepContext): Promise<RunStop | undefined> {
  try { return await runStep(context); } catch (error) {
    if (error instanceof BudgetExceeded) return withLimitNotice(context, guardedStop(error.reason, context.state.reports));
    if (error instanceof RunInterrupted) return guardedStop(error.reason, context.state.reports);
    throw error;
  }
}

/** A limit ends the run with an explanation and a way to continue (see recovery.ts), not a bare failure. */
async function withLimitNotice(context: StepContext, stop: RunStop): Promise<RunStop> {
  const notice = limitNotice(context, stop.reason);
  if (notice !== undefined) await appendRuntimeMessages(context, [notice]);
  return stop;
}

function preflight(context: StepContext): RunStop | undefined {
  const { input, state } = context;
  const interrupted = context.control.check();
  if (interrupted !== undefined) return guardedStop(interrupted, state.reports);
  if (state.modelCalls >= input.maxModelCalls) return { status: 'failed', reason: 'model_call_limit' };
  return undefined;
}

export async function appendRuntimeMessages(context: StepContext, messages: readonly Message[], decision?: ModelDecision['kind']): Promise<void> {
  for (const message of messages) {
    context.state.history.push(message);
    context.state.appended.push(message);
    await context.emit({ type: 'message_appended', message, ...(decision === undefined ? {} : { decision }) });
  }
}

/**
 * Appends waiting steering messages (user role) to the history. Only at a step boundary where every tool call
 * is answered: before a model call, or when the model would stop, so the user is heard before the run concludes.
 */
export async function appendSteering(context: StepContext): Promise<boolean> {
  const take = context.deps.steering?.take;
  if (take === undefined) return false;
  const messages = (await take()).filter(message => message.role === 'user'
    && !context.state.history.some(existing => existing.id === message.id));
  if (messages.length > 0) await appendRuntimeMessages(context, messages);
  return messages.length > 0;
}

function preflightStop(context: StepContext, stop: RunStop): Promise<RunStop> | RunStop {
  return stop.status === 'failed' ? withLimitNotice(context, stop) : stop;
}

function recovering(context: StepContext, step: Awaited<ReturnType<typeof requestDecision>>): boolean {
  if (step.kind === 'failure') return recoverModelFailure(context.state, step.failure);
  if (step.kind === 'invalid') return recoverModelFailure(context.state, 'invalid');
  settleRecovery(context.state);
  return false;
}

async function runStep(context: StepContext): Promise<RunStop | undefined> {
  const blocked = preflight(context);
  if (blocked !== undefined) return preflightStop(context, blocked);
  await appendSteering(context);
  context.budget.step();
  context.state.modelCalls += 1;
  const step = await requestDecision(context);
  if (recovering(context, step)) return undefined; // a cut-off/unusable response is retried, not a failed run
  switch (step.kind) {
    case 'memory': await runMemoryTools(context, step.assistant, step.calls); return undefined;
    case 'discovery': await discoverTools(context, step.assistant, step.call); return undefined;
    case 'client': await runClientTools(context, step.assistant, step.calls); return undefined;
    case 'cancelled': return { status: 'cancelled', reason: 'cancelled' };
    case 'failure': return { status: 'failed', reason: 'model_failure', modelFailure: step.failure };
    case 'invalid': return { status: 'failed', reason: 'invalid_model_response' };
    case 'decision':
      await appendRuntimeMessages(context, [step.assistant], step.decision.kind);
      return handleRuntimeDecision(context, step.decision);
  }
}

/** A final answer or a question ends the run, unless it was interrupted or the user steered meanwhile. */
async function concludeAnswer(context: StepContext, decision: Exclude<ModelDecision, { kind: 'tool_calls' }>,
  interrupted: ReturnType<StepContext['control']['check']>): Promise<RunStop | undefined> {
  if (interrupted !== undefined) return guardedStop(interrupted, context.state.reports);
  if (await appendSteering(context)) return undefined; // answer the user's new message before concluding
  if (decision.kind === 'final') return finalAnswerStop(context.state.reports);
  return { status: 'waiting_for_input', reason: 'needs_input', question: decision.question };
}

export async function handleRuntimeDecision(context: StepContext, decision: ModelDecision, priorReports: readonly ToolCallReport[] = []): Promise<RunStop | undefined> {
  const interrupted = context.control.check();
  if (decision.kind !== 'tool_calls') return concludeAnswer(context, decision, interrupted);
  const { input, deps } = context;
  const result = await executeCalls(decision.calls, {
    index: context.index, validator: deps.validator, policy: deps.policy, mcp: deps.mcp,
    runId: input.runId, emit: context.emit, nextMessageId: () => deps.ids.next('message'),
    control: context.control, budget: context.budget,
    ...(deps.beforeToolInvoke === undefined ? {} : { beforeInvoke: deps.beforeToolInvoke }),
  });
  context.state.reports.push(...result.reports);
  await appendRuntimeMessages(context, result.messages);
  if (result.stopped !== undefined) return guardedStop(result.stopped, context.state.reports);
  if (result.awaitingApproval) return { status: 'waiting_for_approval', reason: 'approval_required' };
  if (result.cancelled) return { status: 'cancelled', reason: 'cancelled' };
  context.budget.correction([...priorReports, ...result.reports]);
  await context.emit({ type: 'batch_finished' });
  return undefined;
}
