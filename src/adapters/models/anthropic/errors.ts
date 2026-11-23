import Anthropic from '@anthropic-ai/sdk';
import { DeadlineExceededError } from '../../../shared/async/errors.js';
import type { ModelFailure, ModelFailureCode } from '../../../contracts/models/gateway.js';
import { withDiagnostic } from '../diagnostic.js';

function failure(code: ModelFailureCode, message: string, retryable = false): ModelFailure {
  return Object.freeze({ code, message, retryable });
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** Most specific first: APIConnectionTimeoutError extends APIConnectionError extends APIError. */
const MAPPINGS: readonly (readonly [ErrorClass, ModelFailure])[] = [
  [Anthropic.APIUserAbortError, failure('cancelled', 'Model call cancelled')],
  [Anthropic.APIConnectionTimeoutError, failure('timeout', 'Model call timed out', true)],
  [Anthropic.APIConnectionError, failure('transport', 'Model provider unreachable', true)],
  [Anthropic.AuthenticationError, failure('authentication_required', 'Model provider rejected the credentials')],
  [Anthropic.PermissionDeniedError, failure('permission', 'Model provider denied access')],
  [Anthropic.RateLimitError, failure('rate_limited', 'Model provider rate limit reached', true)],
];

/**
 * Typed SDK errors only (no message sniffing). Provider error text can echo prompt content, so
 * only the HTTP status is kept. `retryable` is transport guidance for a model call,
 * which has no external side effect; the SDK has already spent its own retries.
 */
export function modelFailureFrom(error: unknown, signal?: AbortSignal): ModelFailure {
  return withDiagnostic(classify(error, signal), error, error instanceof Anthropic.APIError);
}

function classify(error: unknown, signal?: AbortSignal): ModelFailure {
  if (signal?.aborted === true) return failure('cancelled', 'Model call cancelled');
  if (error instanceof DeadlineExceededError) return failure('timeout', 'Model call timed out', true);
  const mapped = MAPPINGS.find(([type]) => error instanceof type);
  if (mapped !== undefined) return mapped[1];
  if (error instanceof Anthropic.InternalServerError) return failure('transport', `Model provider error (${error.status})`, true);
  if (error instanceof Anthropic.APIError) {
    return failure('unsupported', `Model provider rejected the request (${error.status ?? 'n/a'})`);
  }
  return failure('unknown', 'Unexpected model adapter failure');
}
