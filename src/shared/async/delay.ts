// Provenance: ai-intent-api-v2/src/utils/async-helpers.util.ts `sleep`
// SHA-256 44310795f05543c37d0b359325d9ed6d63dcc5d7a42bdc36d875252a6d1d5b1c (P02-02 adaptation).
// Changes: duration validation, AbortSignal support, timer/listener cleanup on settle.

/** Largest delay Node timers honor; larger values silently fire after 1ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface DelayOptions {
  readonly signal?: AbortSignal;
}

/**
 * Resolves after `ms` milliseconds. Zero schedules a macrotask rather than resolving synchronously.
 * Abort rejects with `signal.reason` and clears the timer.
 */
export function delay(ms: number, options: DelayOptions = {}): Promise<void> {
  assertTimerDuration('delay', ms);
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Validates a finite, nonnegative timer duration within the Node timer range. */
export function assertTimerDuration(name: string, ms: unknown): asserts ms is number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`${name} must be a finite duration between 0 and ${MAX_TIMER_DELAY_MS}ms`);
  }
}
