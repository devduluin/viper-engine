import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { McpFailureCode, McpOperationResult, McpToolOutcome } from '../../../contracts/mcp/outcome.js';
import { parseMcpToolOutcome } from '../../../contracts/mcp/parse-outcome.js';
import { normalizedFailure } from '../errors/classify.js';
import { DeadlineExceededError } from '../../../shared/async/errors.js';

/**
 * A JSON-RPC error *response* means the server answered and refused the request. Timeouts,
 * closed connections and aborts are raised locally: the server may still have acted.
 */
const HTTP_REFUSALS: Readonly<Record<number, McpFailureCode>> = { 401: 'authentication_required', 403: 'permission', 404: 'connection_unavailable' };

/** HTTP 401/403/404 (unknown session) are answered before the server handles the message. */
export function httpRefusal(error: unknown): McpFailureCode | undefined {
  return error instanceof StreamableHTTPError && error.code !== undefined ? HTTP_REFUSALS[error.code] : undefined;
}

function serverRefusal(error: unknown): McpFailureCode | undefined {
  const http = httpRefusal(error);
  if (http !== undefined) return http;
  if (!(error instanceof McpError)) return undefined;
  if (error.code === ErrorCode.InvalidParams) return 'invalid_value';
  if (error.code === ErrorCode.MethodNotFound) return 'unsupported';
  return undefined;
}

function localFailure(error: unknown, signal: AbortSignal | undefined): McpFailureCode {
  if (signal?.aborted === true) return 'cancelled';
  if (error instanceof DeadlineExceededError) return 'timeout';
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) return 'timeout';
  if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) return 'connection_unavailable';
  return 'transport';
}

/** A resource URI or prompt name the server did not advertise; it is never requested. */
export class NotAdvertisedError extends Error {}

/** A trusted host access check refused this operation before any tool send. */
export class McpAdmissionError extends Error {
  constructor(readonly code: McpFailureCode) { super('MCP access check refused the operation'); }
}

/** Failure of a read-only operation (list/read/get): no side effect to account for. */
export function operationFailure<Value>(error: unknown, signal?: AbortSignal): McpOperationResult<Value> {
  if (error instanceof McpAdmissionError) return { ok: false, error: normalizedFailure(error.code) };
  if (error instanceof NotAdvertisedError) return { ok: false, error: normalizedFailure('not_found') };
  return { ok: false, error: normalizedFailure(serverRefusal(error) ?? localFailure(error, signal)) };
}

/** The call was never sent, so it is a plain error and safe to report as not applied. */
export function notDispatched(code: McpFailureCode): McpToolOutcome {
  return parseMcpToolOutcome({ status: 'error', content: [], error: normalizedFailure(code) });
}

/**
 * Failure after tools/call was sent. A server refusal is `error`; anything else is `unknown`,
 * because the tool may have run. Raw error text is never forwarded.
 */
export function afterDispatch(error: unknown, signal: AbortSignal | undefined): McpToolOutcome {
  const refused = serverRefusal(error);
  if (refused !== undefined) return notDispatched(refused);
  return parseMcpToolOutcome({ status: 'unknown', content: [], error: normalizedFailure(localFailure(error, signal)) });
}
