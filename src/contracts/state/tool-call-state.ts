import type { StateConflict } from './result.js';

/**
 * Tool-call ledger status. `dispatching` is persisted as dispatch intent BEFORE the external MCP
 * call. Once dispatching, a call can never return to `ready`: repeats need known-not-applied
 * evidence (`retry_wait`), and `unknown` resolves only through reconciliation evidence.
 */
export type ToolCallStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'ready'
  | 'dispatching'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'rejected'
  | 'cancelled';

/**
 * Evidence attached to a transition. The store persists the referenced evidence with the outcome.
 * - known_not_applied: the attempt provably did not reach/execute remotely (e.g. rejected before send).
 * - reconciliation: a later read/lookup established the actual remote outcome.
 */
export type ToolCallEvidence = 'none' | 'known_not_applied' | 'reconciliation';

export interface ToolCallTransitionRule {
  readonly to: ToolCallStatus;
  readonly requires: ToolCallEvidence;
}

export const TOOL_CALL_STATUSES: readonly ToolCallStatus[] = Object.freeze([
  'proposed', 'awaiting_approval', 'ready', 'dispatching', 'retry_wait',
  'succeeded', 'failed', 'unknown', 'rejected', 'cancelled',
]);

const rule = (to: ToolCallStatus, requires: ToolCallEvidence = 'none'): ToolCallTransitionRule =>
  Object.freeze({ to, requires });

export const TOOL_CALL_TRANSITIONS: Readonly<Record<ToolCallStatus, readonly ToolCallTransitionRule[]>> = Object.freeze({
  proposed: Object.freeze([rule('awaiting_approval'), rule('ready'), rule('rejected'), rule('cancelled')]),
  awaiting_approval: Object.freeze([rule('ready'), rule('rejected'), rule('cancelled')]),
  ready: Object.freeze([rule('dispatching'), rule('cancelled')]),
  dispatching: Object.freeze([
    rule('succeeded'), rule('failed'), rule('unknown'), rule('retry_wait', 'known_not_applied'),
  ]),
  retry_wait: Object.freeze([rule('dispatching'), rule('failed'), rule('cancelled')]),
  unknown: Object.freeze([rule('succeeded', 'reconciliation'), rule('failed', 'reconciliation')]),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([]),
});

/** Statuses that a run may end with: final outcomes, plus `unknown` recorded honestly. */
export const SETTLED_TOOL_CALL_STATUSES: ReadonlySet<ToolCallStatus> = new Set<ToolCallStatus>([
  'succeeded', 'failed', 'rejected', 'cancelled', 'unknown',
]);

export function isTerminalToolCallStatus(status: ToolCallStatus): boolean {
  return TOOL_CALL_TRANSITIONS[status].length === 0;
}

export function checkToolCallTransition(
  from: ToolCallStatus,
  to: ToolCallStatus,
  evidence: ToolCallEvidence = 'none',
): StateConflict | undefined {
  const found = TOOL_CALL_TRANSITIONS[from].find(candidate => candidate.to === to);
  if (found === undefined) {
    return { code: 'invalid_transition', message: `Tool call cannot move from ${from} to ${to}` };
  }
  if (found.requires !== 'none' && evidence !== found.requires) {
    return { code: 'evidence_required', message: `Tool call ${from} -> ${to} requires ${found.requires} evidence` };
  }
  return undefined;
}
