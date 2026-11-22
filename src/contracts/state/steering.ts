import type { RunId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { ContextMessage } from '../messages/message.js';

/**
 * Mid-run steering. A user message accepted while a run works is queued, never written to the
 * conversation by the API: only the run's lease holder appends it, at a step boundary, in the same
 * journal commit that settles it. This keeps conversation revisions owned by one writer.
 */
export type SteeringMessage = ContextMessage & { readonly role: 'user' };

/** Run states that accept a steering message (a waiting approval keeps it until the run resumes). */
export const STEERABLE_RUN_STATUSES = ['queued', 'running', 'waiting_for_approval'] as const;

/** Pending inputs per run; beyond this the API answers RATE_LIMITED instead of growing the queue. */
export const MAX_PENDING_STEERING = 16;

/**
 * Stop guard: `require_none` refuses a stop while inputs wait (completed, answered partial, waiting for
 * input), so the holder yields and the next delivery answers them; `discard` settles waiting inputs as
 * discarded for stops that cannot take more input (failure, cancellation, unknown outcome).
 */
export type SteeringSettleMode = 'require_none' | 'discard';

/** Read port for the durable driver; consumption itself is a journal command. */
export interface RunSteeringReader {
  /** Unsettled inputs of this owner's run, oldest first, at most `limit`. */
  pending(scope: TrustedScope, runId: RunId, limit: number): Promise<readonly SteeringMessage[]>;
}
