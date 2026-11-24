import type { StateConflict } from './result.js';
import { SETTLED_TOOL_CALL_STATUSES } from './tool-call-state.js';
import type { ToolCallStatus } from './tool-call-state.js';

/** Run lifecycle from the API contract. There is no device/desktop waiting state. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  /** Parked until awaited sub-agent runs settle; holds no lease (PLAN-SUBAGENTS §4). */
  | 'waiting_for_agents'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export const RUN_STATUSES: readonly RunStatus[] = Object.freeze([
  'queued', 'running', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_agents',
  'completed', 'partial', 'failed', 'cancelled',
]);

/** Terminal runs have no outgoing transition: late results never revive them. */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = Object.freeze({
  queued: Object.freeze<RunStatus[]>(['running', 'cancelled']),
  running: Object.freeze<RunStatus[]>([
    'waiting_for_input', 'waiting_for_approval', 'waiting_for_agents', 'completed', 'partial', 'failed', 'cancelled',
  ]),
  waiting_for_input: Object.freeze<RunStatus[]>(['running', 'failed', 'cancelled']),
  waiting_for_approval: Object.freeze<RunStatus[]>(['running', 'failed', 'cancelled']),
  waiting_for_agents: Object.freeze<RunStatus[]>(['running', 'failed', 'cancelled']),
  completed: Object.freeze<RunStatus[]>([]),
  partial: Object.freeze<RunStatus[]>([]),
  failed: Object.freeze<RunStatus[]>([]),
  cancelled: Object.freeze<RunStatus[]>([]),
});

export function isTerminalRunStatus(status: RunStatus): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}

export function checkRunTransition(from: RunStatus, to: RunStatus): StateConflict | undefined {
  if (RUN_TRANSITIONS[from].includes(to)) return undefined;
  return { code: 'invalid_transition', message: `Run cannot move from ${from} to ${to}` };
}

/**
 * A run may become terminal only when every tool call is settled: no dispatch in flight and no
 * proposal left open. `completed` additionally refuses unknown outcomes; such a run must be
 * reconciled first or end as `partial`/`failed`/`cancelled` with the unknown recorded.
 */
export function checkRunSettlement(to: RunStatus, toolCalls: readonly ToolCallStatus[]): StateConflict | undefined {
  if (!isTerminalRunStatus(to)) return undefined;
  if (toolCalls.some(status => !SETTLED_TOOL_CALL_STATUSES.has(status))) {
    return { code: 'unresolved_tool_calls', message: 'Run has tool calls that are not settled' };
  }
  if (to === 'completed' && toolCalls.includes('unknown')) {
    return { code: 'unresolved_tool_calls', message: 'Completed run cannot hide an unknown tool outcome' };
  }
  return undefined;
}

/** Parked runs that user input, a decision or settled sub-agents may wake without borrowing a lease. */
export const WAKEABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['waiting_for_input', 'waiting_for_approval', 'waiting_for_agents']);
