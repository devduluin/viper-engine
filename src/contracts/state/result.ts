/**
 * Typed state-store outcomes. Expected conflicts are values, not exceptions, so adapters and
 * use cases can map them to stable API errors (e.g. revision_conflict -> 409 REVISION_CONFLICT).
 */
export type StateConflictCode =
  | 'not_found'
  | 'revision_conflict'
  | 'invalid_transition'
  | 'evidence_required'
  | 'unresolved_tool_calls'
  | 'approval_mismatch'
  | 'approval_expired'
  | 'sequence_conflict'
  /** The caller's run lease expired or was taken over (fence mismatch); it must stop writing. */
  | 'lease_lost'
  /** Same idempotency key with a different payload fingerprint. */
  | 'idempotency_conflict'
  /** The bound MCP connection was revoked or needs re-authorization; approval cannot dispatch. */
  | 'access_revoked'
  /** A run may not conclude while a user steering message waits; the holder yields and consumes it first. */
  | 'steering_pending';

export interface StateConflict {
  readonly code: StateConflictCode;
  /** Safe diagnostic; never contains another owner's data. */
  readonly message: string;
  /** Present on revision_conflict so a client can refetch the snapshot. */
  readonly currentRevision?: number;
}

export type StateResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: StateConflict };

export function stateOk<Value>(value: Value): StateResult<Value> {
  return Object.freeze({ ok: true, value });
}

export function stateConflict<Value>(conflict: StateConflict): StateResult<Value> {
  return Object.freeze({ ok: false, error: Object.freeze({ ...conflict }) });
}

/** Revisions start at 1 and increase by exactly one per accepted compare-and-set write. */
export function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Revision must be a positive safe integer');
  }
  return value;
}

/** Compare-and-set check: a stale or future expected revision is a conflict, never a merge. */
export function checkExpectedRevision(current: number, expected: number): StateConflict | undefined {
  parseRevision(expected);
  if (current === expected) return undefined;
  return { code: 'revision_conflict', message: 'Expected revision is stale', currentRevision: current };
}
