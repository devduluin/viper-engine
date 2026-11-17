import { parseJsonObject } from '../messages/json.js';
import type { JsonObject } from '../messages/json.js';
import type { McpFailure, McpFailureCode, McpToolOutcome } from './outcome.js';
import { parseMcpContents } from './parse-content.js';
import { assertMcpFields, mcpString } from './validation.js';

const failureCodes: readonly McpFailureCode[] = [
  'missing_required', 'invalid_value', 'wrong_scope', 'ambiguous_reference', 'not_found', 'permission',
  'authentication_required', 'transient', 'connection_unavailable', 'transport', 'timeout',
  'unsupported', 'cancelled', 'unknown',
];

function isFailureCode(value: unknown): value is McpFailureCode {
  return typeof value === 'string' && (failureCodes as readonly string[]).includes(value);
}

export function parseMcpFailure(value: unknown): McpFailure {
  const input = parseJsonObject(value);
  assertMcpFields(input, ['code', 'message', 'retryable', 'field']);
  const code = input['code'];
  if (!isFailureCode(code) || typeof input['retryable'] !== 'boolean') throw new Error('Invalid normalized MCP failure');
  const base = { code, message: mcpString(input, 'message'), retryable: input['retryable'] };
  return Object.freeze(Object.hasOwn(input, 'field') ? { ...base, field: mcpString(input, 'field') } : base);
}

function optionalOutput(input: JsonObject): { readonly structuredContent?: JsonObject; readonly privateMeta?: JsonObject } {
  return {
    ...(Object.hasOwn(input, 'structuredContent') ? { structuredContent: parseJsonObject(input['structuredContent']) } : {}),
    ...(Object.hasOwn(input, 'privateMeta') ? { privateMeta: parseJsonObject(input['privateMeta']) } : {}),
  };
}

/** Decodes the normalized host contract, not a wire CallToolResult or an auth classifier. */
export function parseMcpToolOutcome(value: unknown): McpToolOutcome {
  const input = parseJsonObject(value);
  assertMcpFields(input, ['status', 'content', 'structuredContent', 'privateMeta', 'error']);
  const output = { content: parseMcpContents(input['content']), ...optionalOutput(input) };
  if (input['status'] === 'success') {
    if (Object.hasOwn(input, 'error')) throw new Error('Successful MCP outcome cannot contain an error');
    return Object.freeze({ status: 'success', ...output });
  }
  if (input['status'] !== 'error' && input['status'] !== 'unknown') throw new Error('Invalid MCP execution status');
  return Object.freeze({ status: input['status'], error: parseMcpFailure(input['error']), ...output });
}
