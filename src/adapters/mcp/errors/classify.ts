// Adapted logic: ai-intent-api-v2/src/utils/mcp-execution-error.util.ts (S05, P02-04).
// Source SHA-256: 342308893a71c53c5efb19f4c2d4d697d5c78d4c976ae6981fd7686c80e3fd76.
// Changes: exact machine codes, explicit trusted transport evidence, no text/substring routing.
import type { McpFailure, McpFailureCode } from '../../../contracts/mcp/outcome.js';

export interface TransportEvidence {
  readonly httpStatus?: number;
  readonly oauthCode?: string;
  readonly networkCode?: string;
}

const codeMap: Readonly<Record<string, McpFailureCode>> = {
  AUTHENTICATION_REQUIRED: 'authentication_required', UNAUTHENTICATED: 'authentication_required',
  INVALID_GRANT: 'authentication_required', INVALID_TOKEN: 'authentication_required', TOKEN_EXPIRED: 'authentication_required',
  FORBIDDEN: 'permission', PERMISSION: 'permission', PERMISSION_DENIED: 'permission',
  INSUFFICIENT_SCOPE: 'permission', ACCESS_DENIED: 'permission', UNAUTHORIZED_CLIENT: 'permission',
  INVALID_CLIENT: 'authentication_required', INVALID_REQUEST: 'invalid_value', INVALID_SCOPE: 'invalid_value',
  UNSUPPORTED_GRANT_TYPE: 'unsupported',
  MISSING_REQUIRED: 'missing_required', MISSING_PARAMETER: 'missing_required',
  INVALID_VALUE: 'invalid_value', INVALID_ARGUMENT: 'invalid_value',
  WRONG_SCOPE: 'wrong_scope', AMBIGUOUS_REFERENCE: 'ambiguous_reference', NOT_FOUND: 'not_found',
  TRANSIENT: 'transient', RATE_LIMIT: 'transient', TOO_MANY_REQUESTS: 'transient', SERVICE_UNAVAILABLE: 'transient',
  TIMEOUT: 'timeout', ETIMEDOUT: 'timeout', ECONNRESET: 'transient', ECONNREFUSED: 'transient',
  ENOTFOUND: 'transient', EAI_AGAIN: 'transient', UNSUPPORTED: 'unsupported', CANCELLED: 'cancelled', ABORT_ERR: 'cancelled', UNKNOWN: 'unknown',
};

export function machineFailureCode(value: unknown): McpFailureCode | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return undefined;
  return codeMap[value.toUpperCase().replaceAll('-', '_')];
}

const statusMap: Readonly<Record<number, McpFailureCode>> = {
  400: 'invalid_value', 401: 'authentication_required', 403: 'permission', 404: 'not_found',
  405: 'unsupported', 408: 'timeout', 429: 'transient', 501: 'unsupported',
};

/** Evidence must be supplied by a transport adapter, never copied from a tool/business body. */
export function transportFailureCode(evidence: TransportEvidence): McpFailureCode | undefined {
  const status = evidence.httpStatus;
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'permission';
  const oauth = machineFailureCode(evidence.oauthCode);
  if (oauth) return oauth;
  if (status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599) {
    const exact = statusMap[status];
    if (exact) return exact;
    if (status >= 500) return 'transient';
  }
  return machineFailureCode(evidence.networkCode);
}

/** Fixed diagnostic avoids reflecting raw errors, tokens, URLs, or arbitrary provider wording. */
export function normalizedFailure(code: McpFailureCode): McpFailure {
  return Object.freeze({ code, message: `MCP operation: ${code}`, retryable: code === 'transient' || code === 'timeout' });
}
