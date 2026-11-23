import type { ModelFailure } from '../../contracts/models/gateway.js';

/** Shape shared by the Anthropic and OpenAI SDK `APIError` classes. */
interface ProviderApiError { readonly status?: number | undefined; readonly error?: unknown; readonly requestID?: string | null | undefined }

const SAFE = /[^A-Za-z0-9_.:-]/g;
const token = (value: unknown, max: number) => typeof value === 'string' ? value.replace(SAFE, '').slice(0, max) : '';

/**
 * Safe provider metadata for a failed model call: HTTP status, the provider's error *type* (e.g.
 * `invalid_request_error`) and its request id, so a rejection can be diagnosed later or reported to the provider.
 * Provider error *text* is never kept: it can echo prompt content.
 */
export function providerDiagnostic(error: ProviderApiError): string | undefined {
  const body = error.error !== null && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
  const nested = body['error'] !== null && typeof body['error'] === 'object' ? body['error'] as Record<string, unknown> : body;
  const parts = [error.status === undefined ? '' : String(error.status), token(nested['type'] ?? nested['code'], 64),
    token(error.requestID, 80)].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export function withDiagnostic(failure: ModelFailure, error: unknown, isApiError: boolean): ModelFailure {
  if (!isApiError) return failure;
  const diagnostic = providerDiagnostic(error as ProviderApiError);
  return diagnostic === undefined ? failure : Object.freeze({ ...failure, diagnostic });
}
