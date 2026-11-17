import type { ApiErrorCode } from './errors.js';
import type { JsonObject } from '../messages/json.js';
import type { StateResult } from '../state/result.js';

/** Safe public failure; internal/SDK/SQL errors are never serialized by object spread. */
export class ApiFailure extends Error {
  constructor(readonly code: ApiErrorCode, readonly recovery?: JsonObject) { super(code); this.name = 'ApiFailure'; }
}

export function requireState<T>(result: StateResult<T>): T {
  if (result.ok) return result.value;
  const { code, currentRevision } = result.error;
  if (code === 'revision_conflict' && currentRevision !== undefined) {
    throw new ApiFailure('REVISION_CONFLICT', { currentRevision, action: 'refresh_revision' });
  }
  const map = { not_found: 'NOT_FOUND', approval_mismatch: 'APPROVAL_MISMATCH', approval_expired: 'APPROVAL_EXPIRED',
    idempotency_conflict: 'IDEMPOTENCY_CONFLICT', access_revoked: 'ACCESS_DENIED' } as const;
  throw new ApiFailure(Object.hasOwn(map, code) ? map[code as keyof typeof map] : 'INVALID_STATE');
}
