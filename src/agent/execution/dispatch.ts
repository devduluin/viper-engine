import type { RunId, ToolCallId } from '../../contracts/identity/ids.js';
import type { McpGateway } from '../../contracts/mcp/gateway.js';
import type { McpToolRef } from '../../contracts/mcp/identity.js';
import type { McpToolOutcome } from '../../contracts/mcp/outcome.js';
import type { ToolFailureCode } from '../../contracts/state/tool-rejection.js';
import { parseMcpToolOutcome } from '../../contracts/mcp/parse-outcome.js';
import type { CallPlan } from './plan-call.js';
import type { CallRejection } from './plan-call.js';
import type { RuntimeTool } from './tool-catalog.js';
import type { ToolCall, ToolResultMessage } from '../../contracts/messages/message.js';
import type { RunBudget } from '../policies/budget.js';
import type { RunControl } from '../policies/control.js';
import type { ExecutionStopReason } from '../policies/limits.js';

/** Final per-call state within one loop invocation. `deferred` waits with an approval batch. */
export type ToolCallStatus =
  | 'succeeded' | 'failed' | 'unknown' | 'rejected' | 'cancelled' | 'awaiting_approval' | 'deferred';

export interface ToolCallReport {
  readonly id: ToolCallId;
  readonly name: string;
  readonly status: ToolCallStatus;
  readonly tool?: McpToolRef;
  readonly failureCode?: ToolFailureCode;
  /** A persisted intent may exist even when the gateway was never invoked. */
  readonly dispatchState?: 'not_sent' | 'sent_or_unknown';
}

export type ExecutionEvent =
  | { readonly type: 'tool_call_dispatching'; readonly toolCallId: ToolCallId; readonly tool: McpToolRef }
  | { readonly type: 'tool_call_reported'; readonly report: ToolCallReport; readonly message?: ToolResultMessage };

/** Awaited: a durable sink can persist dispatch intent before the MCP call starts. */
export type ExecutionEmitter = (event: ExecutionEvent) => Promise<void>;

export interface DispatchContext {
  readonly mcp: McpGateway;
  readonly runId: RunId;
  readonly emit: ExecutionEmitter;
  readonly control: RunControl;
  readonly budget: RunBudget;
  readonly beforeInvoke?: (tool: RuntimeTool, call: ToolCall) => CallRejection | undefined;
}

export interface DispatchResult {
  readonly outcome: McpToolOutcome;
  readonly dispatched: boolean;
  readonly stopped?: ExecutionStopReason;
}

type ExecutablePlan = Extract<CallPlan, { kind: 'execute' }>;

const UNKNOWN_AFTER_DISPATCH = Object.freeze({
  status: 'unknown', content: [],
  error: { code: 'unknown', message: 'Tool call did not return a valid result after dispatch', retryable: false },
});

/**
 * Emits dispatch intent, then calls MCP. A thrown or malformed gateway reply after intent is
 * recorded as `unknown`: the remote side effect may have happened, so it is never retried here.
 */
export async function dispatchCall(plan: ExecutablePlan, context: DispatchContext): Promise<DispatchResult> {
  const tool = plan.tool.definition.ref;
  const before = dispatchStop(plan, context);
  if (before !== undefined) return notDispatched(before);
  await context.emit({ type: 'tool_call_dispatching', toolCallId: plan.call.id, tool });
  const after = dispatchStop(plan, context);
  if (after !== undefined) return notDispatched(after);
  const denied = context.beforeInvoke?.(plan.tool, plan.call);
  if (denied !== undefined) return { dispatched: false, outcome: parseMcpToolOutcome({
    status: 'error', content: [], error: { ...denied, retryable: false },
  }) };
  try {
    const received = await context.control.call(signal => context.mcp.callTool({
      ...plan.tool.context, runId: context.runId, toolCallId: plan.call.id, tool, arguments: plan.call.arguments,
    }, { signal, deadlineAt: context.control.deadlineAt }));
    const outcome = parseMcpToolOutcome(received);
    const stopped = context.budget.output('tool', outcome) ?? context.control.check();
    if (outcome.status === 'unknown') context.budget.recordUnknown(plan.call.id);
    return { outcome: stopped === undefined ? outcome : omittedOutcome(outcome), dispatched: true,
      ...(stopped === undefined ? {} : { stopped }) };
  } catch {
    context.budget.recordUnknown(plan.call.id);
    const stopped = context.control.check();
    return { outcome: parseMcpToolOutcome(UNKNOWN_AFTER_DISPATCH), dispatched: true,
      ...(stopped === undefined ? {} : { stopped }) };
  }
}

function dispatchStop(plan: ExecutablePlan, context: DispatchContext): ExecutionStopReason | undefined {
  return context.control.check() ?? (context.budget.isUncertain(plan.call.id) ? 'unknown_outcome' : undefined);
}

function notDispatched(stopped: ExecutionStopReason): DispatchResult {
  return { dispatched: false, stopped, outcome: parseMcpToolOutcome({ status: 'error', content: [], error: {
    code: stopped === 'cancelled' ? 'cancelled' : 'permission',
    message: 'Execution stopped before dispatch', retryable: false,
  } }) };
}

function omittedOutcome(outcome: McpToolOutcome): McpToolOutcome {
  return parseMcpToolOutcome({ status: outcome.status, content: [{ type: 'text', text: 'Tool output omitted by runtime limit' }],
    ...(outcome.status === 'success' ? {} : { error: { ...outcome.error, message: 'Tool outcome recorded; output omitted', retryable: false } }),
  });
}

export function outcomeStatus(outcome: McpToolOutcome): ToolCallStatus {
  if (outcome.status === 'success') return 'succeeded';
  return outcome.status === 'error' ? 'failed' : 'unknown';
}
