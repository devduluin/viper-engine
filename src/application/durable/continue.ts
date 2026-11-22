import { appendSteering, driveAgentLoop, handleRuntimeDecision, snapshotLoopResult } from '../../agent/runtime/run-loop.js';
import { finalAnswerStop } from '../../agent/runtime/outcome.js';
import { BudgetExceeded } from '../../agent/policies/limits.js';
import { RunInterrupted } from '../../agent/policies/control.js';
import { guardedStop } from '../../agent/runtime/stops.js';
import type { RunStop } from '../../agent/runtime/types.js';
import type { DurableSession } from './session.js';
import { pendingFor, materializeAmendments, batchReports } from './recovery.js';

export async function stop(session: DurableSession, result: RunStop) {
  if (session.context === undefined) throw new Error('No runtime context');
  await session.context.emit({ type: 'run_stopped', status: result.status, reason: result.reason });
  return snapshotLoopResult(session.context, result);
}

export async function continueRun(session: DurableSession) {
  const context = session.context;
  if (context === undefined) throw new Error('No runtime context');
  try {
    const pending = pendingFor(session);
    if (pending.length === 0 && session.state.phase === 'correction') {
      context.budget.correction(batchReports(session));
      session.state.phase = 'model'; await session.commit();
    }
    const first = await resumeBatch(session);
    if (first !== undefined) return stop(session, first);
    await materializeAmendments(session);
    const amended = await resumeBatch(session);
    return amended === undefined ? finishOrDrive(session) : stop(session, amended);
  } catch (error) {
    if (error instanceof BudgetExceeded || error instanceof RunInterrupted) return stop(session, guardedStop(error.reason, context.state.reports));
    throw error;
  }
}

async function resumeBatch(session: DurableSession): Promise<RunStop | undefined> {
  const pending = pendingFor(session);
  const context = session.context;
  if (pending.length === 0 || context === undefined) return undefined;
  session.syncHistory();
  const ids = new Set(pending.map(call => call.id));
  const prior = session.state.reports.filter(report => !ids.has(report.id));
  context.state.reports.splice(0, context.state.reports.length, ...prior);
  return handleRuntimeDecision(context, { kind: 'tool_calls', calls: pending, content: [] }, batchReports(session).filter(report => !ids.has(report.id)));
}

async function finishOrDrive(session: DurableSession) {
  const context = session.context;
  if (context === undefined) throw new Error('No runtime context');
  // A user message queued while the run worked (or right before it concluded) is answered before any stop.
  if ((session.state.phase === 'final' || session.state.phase === 'input') && await appendSteering(context)) return driveAgentLoop(context);
  if (session.state.phase === 'final') return stop(session, finalAnswerStop(context.state.reports));
  if (session.state.phase === 'input' && session.checkpoint.history.at(-1)?.role !== 'user') return stop(session, { status: 'waiting_for_input', reason: 'needs_input' });
  return driveAgentLoop(context);
}
