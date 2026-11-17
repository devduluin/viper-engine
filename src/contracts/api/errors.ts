import { id, object, ref, revision, text } from './schema.js';

export const API_ERROR_STATUS = {
  INVALID_REQUEST: 400, AUTHENTICATION_REQUIRED: 401, ACCESS_DENIED: 403, NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409, REVISION_CONFLICT: 409, INVALID_STATE: 409,
  APPROVAL_REQUIRED: 409, APPROVAL_EXPIRED: 409, APPROVAL_MISMATCH: 409,
  OUTCOME_UNKNOWN: 409, EVENT_CURSOR_EXPIRED: 410, INVALID_CURSOR: 400,
  PAYLOAD_TOO_LARGE: 413, BUDGET_EXCEEDED: 422, RATE_LIMITED: 429,
  CONNECTION_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export const ERROR_SCHEMAS = {
  ErrorRecovery: object({
    currentRevision: revision, runId: id, approvalId: id,
    action: { enum: ['fetch_snapshot', 'refresh_revision', 'authenticate', 'reconcile', 'retry_later'] },
    retryAfterMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
  }, []),
  ApiError: { ...object({ code: { enum: Object.keys(API_ERROR_STATUS) }, message: text,
    requestId: id, retryable: { type: 'boolean' }, recovery: ref('ErrorRecovery'),
  }, ['code', 'message', 'requestId', 'retryable']), allOf: [
    { if: { properties: { code: { const: 'REVISION_CONFLICT' } }, required: ['code'] },
      then: { required: ['recovery'], properties: { recovery: { type: 'object',
        properties: { currentRevision: revision, action: { const: 'refresh_revision' } }, required: ['currentRevision', 'action'],
      } } },
    },
    { if: { properties: { code: { const: 'EVENT_CURSOR_EXPIRED' } }, required: ['code'] },
      then: { required: ['recovery'], properties: { recovery: { type: 'object',
        properties: { runId: id, action: { const: 'fetch_snapshot' } }, required: ['runId', 'action'],
      } } },
    },
  ] },
  ErrorResponse: object({ error: ref('ApiError') }),
} as const;
