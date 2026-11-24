import type { Message } from '../../contracts/messages/message.js';
import type { JournalCommand } from '../../contracts/state/journal.js';
import { MAX_PENDING_STEERING } from '../../contracts/state/steering.js';
import type { SteeringSettleMode } from '../../contracts/state/steering.js';
import type { RunLoopStatus, RunStopReason } from '../../agent/runtime/types.js';
import type { DurableSession } from './session.js';

/** Stops that conclude on the model's own answer: every producer appends steering first (run-loop, continue). */
const ANSWER_STOPS: readonly RunStopReason[] = ['final_answer', 'tool_failures', 'needs_input'];

/** Waiting inputs for this delivery; remembered so their append commit also settles them as consumed. */
export async function takeSteering(session: DurableSession): Promise<readonly Message[]> {
  const reader = session.deps.steeringInputs;
  if (reader === undefined) return [];
  const pending = await reader.pending(session.scope, session.claim.runId, MAX_PENDING_STEERING);
  const fresh = pending.filter(message => !session.checkpoint.history.some(existing => existing.id === message.id));
  for (const message of fresh) session.steeringIds.add(message.id);
  return fresh;
}

/** Appending a steering message consumes it atomically and returns the run to the model phase. */
export function steeringConsumption(session: DurableSession, message: Message): JournalCommand[] {
  if (message.role !== 'user' || !session.steeringIds.has(message.id)) return [];
  session.steeringIds.delete(message.id);
  session.state.phase = 'model';
  return [{ kind: 'steering_consume', messageIds: [message.id] }];
}

/**
 * Guard for a stop commit. An answer stop must not conclude over a waiting input: the commit is refused
 * (steering_pending), the holder yields and the next delivery appends the input first. Other stops cannot
 * take input, so waiting inputs are discarded with them; a waiting approval keeps them for its resume.
 */
export function steeringStopGuard(session: DurableSession, status: RunLoopStatus, reason: RunStopReason): JournalCommand[] {
  if (status === 'waiting_for_approval' || status === 'waiting_for_agents') return [];
  const mode: SteeringSettleMode = session.deps.steeringInputs !== undefined && ANSWER_STOPS.includes(reason) ? 'require_none' : 'discard';
  return [{ kind: 'steering_settle', mode }];
}
