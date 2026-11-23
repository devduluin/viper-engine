import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/error';
import { DeadlineExceededError } from '../../../shared/async/errors.js';
import type { ModelFailure, ModelFailureCode } from '../../../contracts/models/gateway.js';
import { withDiagnostic } from '../diagnostic.js';

function failure(code: ModelFailureCode, message: string, retryable = false): ModelFailure {
  return Object.freeze({ code, message, retryable });
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** Most specific first (timeout extends connection error extends APIError). */
const MAPPINGS: readonly (readonly [ErrorClass, ModelFailure])[] = [
  [OpenAI.APIUserAbortError, failure('cancelled', 'Model call cancelled')],
  [OpenAI.APIConnectionTimeoutError, failure('timeout', 'Model call timed out', true)],
  [OpenAI.APIConnectionError, failure('transport', 'Model provider unreachable', true)],
  [OpenAI.AuthenticationError, failure('authentication_required', 'Model provider rejected the credentials')],
  [OpenAI.PermissionDeniedError, failure('permission', 'Model provider denied access')],
  [OpenAI.RateLimitError, failure('rate_limited', 'Model provider rate limit reached', true)],
  [LengthFinishReasonError, failure('output_limit', 'Model output reached max_completion_tokens')],
  [ContentFilterFinishReasonError, failure('permission', 'Model output was blocked by the provider content filter')],
];

/** Typed SDK errors only; provider text is never echoed (it can contain prompt content). */
export function modelFailureFrom(error: unknown, signal?: AbortSignal): ModelFailure {
  return withDiagnostic(classify(error, signal), error, error instanceof OpenAI.APIError);
}

function classify(error: unknown, signal?: AbortSignal): ModelFailure {
  if (signal?.aborted === true) return failure('cancelled', 'Model call cancelled');
  if (error instanceof DeadlineExceededError) return failure('timeout', 'Model call timed out', true);
  const mapped = MAPPINGS.find(([type]) => error instanceof type);
  if (mapped !== undefined) return mapped[1];
  if (error instanceof OpenAI.InternalServerError) return failure('transport', `Model provider error (${error.status})`, true);
  if (error instanceof OpenAI.APIError) {
    return failure('unsupported', `Model provider rejected the request (${error.status ?? 'n/a'})`);
  }
  return failure('unknown', 'Unexpected model adapter failure');
}
