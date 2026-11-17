import type { MessageId } from '../../contracts/identity/ids.js';
import type { ToolCall, ToolResultMessage } from '../../contracts/messages/message.js';
import type { DispatchContext, DispatchResult, ToolCallReport } from './dispatch.js';
import { dispatchCall, outcomeStatus } from './dispatch.js';
import type { CallPlan, PlanDependencies } from './plan-call.js';
import { planCall } from './plan-call.js';
import { outcomeMessage, rejectionMessage } from './result-message.js';
import type { ExecutionStopReason } from '../policies/limits.js';

export interface ExecutionContext extends DispatchContext, PlanDependencies {
  readonly nextMessageId: () => MessageId;
}

export interface ExecutionResult {
  /** Tool results to append, in the model's call order. */
  readonly messages: readonly ToolResultMessage[];
  readonly reports: readonly ToolCallReport[];
  readonly awaitingApproval: boolean;
  readonly cancelled: boolean;
  readonly stopped?: ExecutionStopReason;
}

interface Settled {
  readonly message?: ToolResultMessage;
  readonly report: ToolCallReport;
  readonly stopped?: ExecutionStopReason;
}

const CANCELLED = Object.freeze({ code: 'cancelled', message: 'Run cancelled before this call was dispatched' } as const);

function report(call: ToolCall, status: ToolCallReport['status'], extra: Partial<ToolCallReport> = {}): ToolCallReport {
  return Object.freeze({ id: call.id, name: call.name, status, ...extra });
}

async function settlePlan(plan: CallPlan, stopped: ExecutionStopReason | undefined, context: ExecutionContext): Promise<Settled> {
  const { call } = plan;
  if (plan.kind === 'rejected') {
    const failureCode = plan.rejection.code;
    return { message: rejectionMessage(context.nextMessageId(), call, plan.rejection), report: report(call, 'rejected', { failureCode }) };
  }
  if (stopped !== undefined) {
    const rejected = stopped === 'cancelled' ? CANCELLED : { code: 'permission' as const, message: 'Runtime limit prevents further dispatch' };
    return { message: rejectionMessage(context.nextMessageId(), call, rejected),
      report: report(call, stopped === 'cancelled' ? 'cancelled' : 'rejected', {
        failureCode: rejected.code, dispatchState: 'not_sent',
      }), stopped };
  }
  if (plan.kind === 'approval') throw new Error('Approval plans are held, never dispatched');
  const dispatched = await dispatchCall(plan, context);
  const { outcome } = dispatched;
  if (!dispatched.dispatched) return undispatched(call, dispatched, context);
  const status = outcomeStatus(outcome);
  const tool = plan.tool.definition.ref;
  return {
    message: outcomeMessage(context.nextMessageId(), call, outcome),
    report: report(call, status, { tool, dispatchState: 'sent_or_unknown',
      ...(outcome.status === 'success' ? {} : { failureCode: outcome.error.code }),
    }),
    ...(dispatched.stopped === undefined ? {} : { stopped: dispatched.stopped }),
  };
}

function undispatched(call: ToolCall, result: DispatchResult, context: ExecutionContext): Settled {
  if (result.outcome.status === 'success') throw new Error('Undispatched call cannot succeed');
  const rejection = result.outcome.error;
  return {
    message: rejectionMessage(context.nextMessageId(), call, rejection),
    report: report(call, result.stopped === 'cancelled' ? 'cancelled' : 'rejected', {
      failureCode: rejection.code, dispatchState: 'not_sent',
    }),
    ...(result.stopped === undefined ? {} : { stopped: result.stopped }),
  };
}

/** Approval needed anywhere in the batch: nothing dispatches; only rejections are answered now. */
async function holdForApproval(plans: readonly CallPlan[], context: ExecutionContext): Promise<ExecutionResult> {
  const messages: ToolResultMessage[] = [];
  const reports: ToolCallReport[] = [];
  for (const plan of plans) {
    const settled: Settled = plan.kind === 'rejected'
      ? await settlePlan(plan, undefined, context)
      : { report: report(plan.call, plan.kind === 'approval' ? 'awaiting_approval' : 'deferred', { tool: plan.tool.definition.ref }) };
    if (settled.message !== undefined) messages.push(settled.message);
    reports.push(settled.report);
    await context.emit({ type: 'tool_call_reported', report: settled.report,
      ...(settled.message === undefined ? {} : { message: settled.message }) });
  }
  if (context.control.check() !== undefined) return settleBatch(plans, context);
  return Object.freeze({ messages, reports, awaitingApproval: true, cancelled: false });
}

/**
 * Plans every call first, then dispatches sequentially in model order. Each dispatched call gets
 * exactly one result message, preserving call/result pairing. Cancellation stops new dispatches.
 */
export async function executeCalls(calls: readonly ToolCall[], context: ExecutionContext): Promise<ExecutionResult> {
  const plans = calls.map(call => planCall(call, context));
  if (context.control.check() === undefined && plans.some(plan => plan.kind === 'approval')) return holdForApproval(plans, context);
  return settleBatch(plans, context);
}

async function settleBatch(plans: readonly CallPlan[], context: ExecutionContext): Promise<ExecutionResult> {
  const messages: ToolResultMessage[] = [];
  const reports: ToolCallReport[] = [];
  let stopped: ExecutionStopReason | undefined = context.control.check();
  for (const plan of plans) {
    stopped ??= context.control.check();
    const settled = await settlePlan(plan, stopped, context);
    stopped ??= settled.stopped;
    if (settled.message !== undefined) messages.push(settled.message);
    reports.push(settled.report);
    await context.emit({ type: 'tool_call_reported', report: settled.report,
      ...(settled.message === undefined ? {} : { message: settled.message }) });
  }
  stopped ??= context.control.check();
  return Object.freeze({ messages, reports, awaitingApproval: false, cancelled: stopped === 'cancelled',
    ...(stopped === undefined ? {} : { stopped }) });
}
