import { RunControl } from '../../agent/policies/control.js';
import { snapshotLoopResult } from '../../agent/runtime/run-loop.js';
import type { RunLoopResult } from '../../agent/runtime/types.js';
import { capturePause, unansweredCalls } from './session-view.js';
import { beforeSessionInvoke, emitSessionEvent, sessionPolicy } from './session-policy.js';
import type { SessionState } from './session-state.js';

/** Reuses budget, IDs, model count and history; original absolute deadline includes human pauses. */
export async function activateSession(state: SessionState, work: () => Promise<RunLoopResult>): Promise<void> {
  const before = state.context;
  const control = new RunControl(state.deps.clock, before.budget.limits.maxDurationMs,
    before.control.deadlineAt, before.input.signal);
  state.context = { ...before, control, deps: { ...state.deps, policy: sessionPolicy(state),
    beforeToolInvoke: (tool, call) => beforeSessionInvoke(state, tool, call),
  },
    emit: event => emitSessionEvent(state, event),
  };
  try {
    state.result = await work();
    const pendingIds = new Set<string>(unansweredCalls(state).map(call => call.id));
    for (const id of state.pending.keys()) if (!pendingIds.has(id)) state.pending.delete(id);
    capturePause(state);
  } catch (error) {
    // Intent/outcome persistence faults must never let an in-memory retry duplicate an effect.
    state.poisoned = true;
    throw error;
  } finally { control.close(); }
}

export function removePendingReports(state: SessionState): void {
  state.context.state.reports.splice(0, state.context.state.reports.length,
    ...state.context.state.reports.filter(report => !state.pending.has(report.id)));
}

export function updatePausedSnapshot(state: SessionState): void {
  state.result = snapshotLoopResult(state.context, state.result);
}
