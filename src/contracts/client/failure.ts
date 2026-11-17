import type { ApiErrorCode } from '../api/errors.js';

export type ClientFailureCode = ApiErrorCode | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED'
  | 'INVALID_RESPONSE' | 'STREAM_GAP' | 'STREAM_CLOSED' | 'UNSUPPORTED_EVENT' | 'RECONNECT_LIMIT';
export interface ClientRecovery {
  readonly currentRevision?: number; readonly runId?: string; readonly approvalId?: string;
  readonly action?: 'fetch_snapshot' | 'refresh_revision' | 'authenticate' | 'reconcile' | 'retry_later';
  readonly retryAfterMs?: number;
}
export interface ClientErrorView {
  readonly error: { readonly code: ApiErrorCode; readonly message: string; readonly requestId: string;
    readonly retryable: boolean; readonly recovery?: ClientRecovery };
}

/** Deliberately excludes raw bodies, URL/token values and provider diagnostics. */
export class EngineClientFailure extends Error {
  readonly status?: number; readonly recovery?: ClientRecovery; readonly requestId?: string;
  constructor(readonly code: ClientFailureCode, details: { status?: number; recovery?: ClientRecovery; requestId?: string } = {}) {
    super(`Viper client: ${code}`); this.name = 'EngineClientFailure';
    if (details.status !== undefined) this.status = details.status;
    if (details.recovery !== undefined) this.recovery = details.recovery;
    if (details.requestId !== undefined) this.requestId = details.requestId;
  }
}
