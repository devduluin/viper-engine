import type { TrustedScope } from '../identity/scope.js';
import type { StateResult } from './result.js';

export interface IdempotencyKey {
  /** Stable operation name, e.g. `runs.create`; keys never collide across operations. */
  readonly operation: string;
  /** Client-supplied `Idempotency-Key`, scoped to the authenticated owner. */
  readonly key: string;
  /** SHA-256 of the canonical request payload (shared/fingerprints, domain + version). */
  readonly fingerprint: string;
}

export type IdempotencyBegin =
  /** First request: perform the operation, then `complete` (or `abandon` on failure). */
  | { readonly status: 'started'; readonly claimId: string }
  /** Already completed: return the stored resource instead of repeating the operation. */
  | { readonly status: 'replay'; readonly resourceRef: string }
  /** Another request with this key is still running: answer 409/retry-later, do not repeat. */
  | { readonly status: 'in_progress' };

/**
 * Request deduplication (`request_idempotency`). Same key + same fingerprint is the same request;
 * same key + different fingerprint is `idempotency_conflict`. Expired keys start over.
 */
export interface IdempotencyStore {
  begin(scope: TrustedScope, request: IdempotencyKey & { readonly at: number; readonly ttlMs: number }): Promise<StateResult<IdempotencyBegin>>;
  complete(scope: TrustedScope, request: IdempotencyKey & { readonly claimId: string; readonly resourceRef: string }): Promise<StateResult<{ readonly resourceRef: string }>>;
  /** Removes an unfinished claim after a failure that created nothing, so a retry can start. */
  abandon(scope: TrustedScope, request: IdempotencyKey & { readonly claimId: string }): Promise<StateResult<{ readonly abandoned: boolean }>>;
}

export function parseIdempotencyKey(input: IdempotencyKey): IdempotencyKey {
  if (!/^[a-z][a-z0-9_.]{0,63}$/.test(input.operation)) throw new Error('Invalid idempotency operation');
  if (input.key.length < 1 || input.key.length > 256 || /[\p{Cc}]/u.test(input.key)) throw new Error('Invalid idempotency key');
  if (!/^[0-9a-f]{64}$/.test(input.fingerprint)) throw new Error('Invalid payload fingerprint');
  return Object.freeze({ operation: input.operation, key: input.key, fingerprint: input.fingerprint });
}
