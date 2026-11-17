import { parseId } from '../identity/ids.js';
import { parseJsonObject } from '../messages/json.js';
import type { McpCapabilities, McpFeature } from './capabilities.js';
import { assertMcpFeature } from './capabilities.js';
import type { McpContext } from './identity.js';
import { assertMcpContext, assertMcpToolBinding } from './identity.js';
import type { McpCallOptions, McpToolCallRequest } from './gateway.js';

/** Pre-dispatch checks only: abort/deadline is not proof of rollback after dispatch. */
export function assertMcpCallOptions(options: McpCallOptions, now: number): void {
  if (!Number.isFinite(now)) throw new Error('Invalid current instant');
  options.signal?.throwIfAborted();
  if (options.deadlineAt !== undefined && (!Number.isFinite(options.deadlineAt) || options.deadlineAt <= now)) {
    throw new Error('MCP deadline expired or invalid');
  }
}

export function assertMcpOperation(
  context: McpContext, capabilities: McpCapabilities, feature: McpFeature,
  now: number, options: McpCallOptions = {},
): void {
  assertMcpContext(context);
  assertMcpFeature(capabilities, feature);
  assertMcpCallOptions(options, now);
}

export function assertMcpToolCall(
  request: McpToolCallRequest, capabilities: McpCapabilities,
  now: number, options: McpCallOptions = {},
): void {
  assertMcpOperation(request, capabilities, 'tools', now, options);
  assertMcpToolBinding(request, request.tool);
  parseId('run', request.runId);
  parseId('tool_call', request.toolCallId);
  parseJsonObject(request.arguments);
}
