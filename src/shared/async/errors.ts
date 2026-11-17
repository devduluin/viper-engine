// Error types for shared async components (P02-02). See docs/handoffs/P02-02.md.

/**
 * The caller stopped waiting after `timeoutMs`. This does not prove that the underlying
 * operation stopped, rolled back or failed remotely; its outcome may still be unknown.
 */
export class DeadlineExceededError extends Error {
  override readonly name = 'DeadlineExceededError';
  readonly operationName: string;
  readonly timeoutMs: number;

  constructor(operationName: string, timeoutMs: number) {
    super(`${operationName} timed out after ${timeoutMs}ms`);
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
  }
}

export type RetryStopReason = 'exhausted' | 'not_retryable';

/** Retry ended without success. `attempts` counts actual operation calls; `cause` is the last error. */
export class RetryError extends Error {
  override readonly name = 'RetryError';
  readonly operationName: string;
  readonly attempts: number;
  readonly reason: RetryStopReason;

  constructor(operationName: string, attempts: number, reason: RetryStopReason, cause: unknown) {
    super(`${operationName} failed after ${attempts} attempt(s) (${reason}). Last error: ${describe(cause)}`, { cause });
    this.operationName = operationName;
    this.attempts = attempts;
    this.reason = reason;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
