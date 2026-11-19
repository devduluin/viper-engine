import type { ConversationId, RunId, ToolCallId } from '../identity/ids.js';
import type { OwnerScope } from './owner.js';
import type { StateConflict, StateResult } from './result.js';
import type { RunStatus } from './run-state.js';

/**
 * Proof that a worker holds a run's lease. `fence` increases on every claim, so a worker whose
 * lease expired and was claimed by another worker can no longer write (fencing token).
 */
export interface LeaseToken {
  readonly workerId: string;
  readonly fence: number;
}

/** Stored lease columns of a run as read inside the writing transaction. */
export interface LeaseState {
  readonly owner?: string;
  readonly fence: number;
  readonly expiresAt?: number;
}

export interface RunClaim {
  readonly runId: RunId;
  readonly conversationId: ConversationId;
  /** Loaded by the server from storage; the driver builds its trusted scope from it. */
  readonly owner: OwnerScope;
  readonly status: RunStatus;
  readonly revision: number;
  readonly lease: LeaseToken;
  readonly expiresAt: number;
  readonly cancelRequested: boolean;
  /**
   * Calls left in `dispatching` by a previous holder (crash window). Their outcome is unknown:
   * the new holder reconciles them and must never dispatch them again.
   */
  readonly inFlightToolCalls: readonly ToolCallId[];
}

/**
 * Durable-driver claims. At-least-once delivery of work, never exactly-once execution: a remote
 * write that was in flight during a crash stays `unknown` until reconciled.
 */
export interface RunLeaseStore {
  /** Queued/running or cancelling waiting run; PostgreSQL owns expiry/duration time, not worker `at`. */
  claimNext(workerId: string, at: number, leaseMs: number): Promise<RunClaim | undefined>;
  renew(runId: RunId, lease: LeaseToken, at: number, leaseMs: number): Promise<StateResult<{ readonly expiresAt: number }>>;
  release(runId: RunId, lease: LeaseToken, at: number): Promise<StateResult<{ readonly released: true }>>;
}

export function parseWorkerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('Invalid worker identifier');
  return value;
}

export function parseLeaseDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1_000 || value > 3_600_000) {
    throw new RangeError('Lease duration must be 1s..1h in milliseconds');
  }
  return value;
}

/** A write under a lease is valid only for the current holder, current fence, before expiry. */
export function checkLease(state: LeaseState, token: LeaseToken, at: number): StateConflict | undefined {
  const held = Number.isSafeInteger(at) && at >= 0 && Number.isSafeInteger(token.fence) && token.fence >= 1
    && state.owner === token.workerId && state.fence === token.fence
    && state.expiresAt !== undefined && at < state.expiresAt;
  return held ? undefined : { code: 'lease_lost', message: 'Run lease is no longer held by this worker' };
}
