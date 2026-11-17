// Provenance: ai-intent-api-v2/src/utils/async-helpers.util.ts `withTimeout`
// SHA-256 44310795f05543c37d0b359325d9ed6d63dcc5d7a42bdc36d875252a6d1d5b1c (P02-02 adaptation).
// Changes: operation factory receives an AbortSignal that is aborted on timeout or caller abort.

import { assertTimerDuration } from './delay.js';
import { DeadlineExceededError } from './errors.js';

export interface DeadlineOptions {
  readonly timeoutMs: number;
  readonly operationName: string;
  readonly signal?: AbortSignal;
}

/**
 * Waits at most `timeoutMs` for `operation`. On timeout the operation's signal is aborted with
 * a DeadlineExceededError and the returned promise rejects with it. Aborting is a request only:
 * work that ignores the signal keeps running, and a remote side effect may have happened.
 * Never treat this rejection as proof of cancellation or as permission to repeat a write.
 */
export function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: DeadlineOptions,
): Promise<T> {
  assertTimerDuration('timeoutMs', options.timeoutMs);
  const caller = options.signal;
  if (caller?.aborted) return Promise.reject(caller.reason);
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const stop = (reason: unknown): void => {
      cleanup();
      controller.abort(reason);
      reject(reason);
    };
    const onCallerAbort = (): void => stop(caller?.reason);
    const timer = setTimeout(
      () => stop(new DeadlineExceededError(options.operationName, options.timeoutMs)),
      options.timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    };
    caller?.addEventListener('abort', onCallerAbort, { once: true });
    startOperation(operation, controller.signal).then(
      value => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

function startOperation<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return Promise.resolve(operation(signal));
  } catch (error) {
    return Promise.reject(error);
  }
}
