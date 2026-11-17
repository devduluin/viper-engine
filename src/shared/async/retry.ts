// Provenance: ai-intent-api-v2/src/utils/async-helpers.util.ts `withRetry`, `RetryConfig`
// SHA-256 44310795f05543c37d0b359325d9ed6d63dcc5d7a42bdc36d875252a6d1d5b1c (P02-02 adaptation).
// Changes: caller-owned retry decision, total-attempt accounting, injected wait/jitter/observer,
// no message-substring heuristic and no global logger.

import { assertTimerDuration, delay } from './delay.js';
import { RetryError } from './errors.js';

export interface RetryTiming {
  /** Total operation calls including the first. Legacy `maxRetries: n` equals `maxAttempts: n + 1`. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Upper bound of random extra delay; legacy used 100ms. */
  readonly maxJitterMs: number;
}

export interface RetryPolicy extends RetryTiming {
  /**
   * Decides whether another call is safe. The policy owner must account for idempotency and side
   * effects: a transient-looking transport error does not make repeating a remote write safe.
   */
  readonly shouldRetry: (error: unknown, attempt: number) => boolean;
}

export interface RetryEvent {
  readonly operationName: string;
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: unknown;
}

export interface RetryOptions {
  readonly operationName: string;
  readonly signal?: AbortSignal;
  /** Observer for retry scheduling; its failures never change control flow. */
  readonly onRetry?: (event: RetryEvent) => void;
  /** Returns a number in [0, 1); defaults to Math.random. Inject for deterministic tests. */
  readonly random?: () => number;
  /** Waits between attempts; defaults to abortable `delay`. */
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetrySuccess<T> {
  readonly value: T;
  readonly attempts: number;
}

/** Legacy DEFAULT_RETRY_CONFIG timing (maxRetries 2, 500ms base, 5s cap, 100ms jitter). */
export const DEFAULT_RETRY_TIMING: RetryTiming = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
  maxJitterMs: 100,
});

/**
 * Calls `operation` until it succeeds, the policy refuses, or attempts are exhausted.
 * Resolves with the value and actual attempt count; otherwise rejects with RetryError
 * (cause = last error). Abort rejects with `signal.reason` and starts no further attempt.
 */
export async function withRetry<T>(
  operation: (attempt: number, signal?: AbortSignal) => Promise<T>,
  policy: RetryPolicy,
  options: RetryOptions,
): Promise<RetrySuccess<T>> {
  assertRetryPolicy(policy);
  const { signal } = options;
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return { value: await operation(attempt, signal), attempts: attempt };
    } catch (error) {
      const stop = stopReason(policy, error, attempt);
      if (stop !== undefined) throw new RetryError(options.operationName, attempt, stop, error);
      const delayMs = backoffDelay(policy, attempt, options.random ?? Math.random);
      notify(options, { operationName: options.operationName, attempt, delayMs, error });
      await (options.wait ?? waitWithDelay)(delayMs, signal);
    }
  }
}

/** Capped exponential backoff after failed attempt `attempt` (1-based), plus bounded jitter. */
export function backoffDelay(timing: RetryTiming, attempt: number, random: () => number): number {
  const exponential = timing.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential + random() * timing.maxJitterMs, timing.maxDelayMs);
}

function stopReason(policy: RetryPolicy, error: unknown, attempt: number): RetryError['reason'] | undefined {
  if (attempt >= policy.maxAttempts) return 'exhausted';
  return policy.shouldRetry(error, attempt) ? undefined : 'not_retryable';
}

function notify(options: RetryOptions, event: RetryEvent): void {
  try {
    options.onRetry?.(event);
  } catch {
    // Observability must not decide whether an operation is retried.
  }
}

function waitWithDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return signal === undefined ? delay(ms) : delay(ms, { signal });
}

function assertRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }
  assertTimerDuration('baseDelayMs', policy.baseDelayMs);
  assertTimerDuration('maxDelayMs', policy.maxDelayMs);
  assertTimerDuration('maxJitterMs', policy.maxJitterMs);
  if (typeof policy.shouldRetry !== 'function') throw new TypeError('shouldRetry policy is required');
}
