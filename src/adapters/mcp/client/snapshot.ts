import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { McpContext } from '../../../contracts/mcp/identity.js';
import { assertMcpContext } from '../../../contracts/mcp/identity.js';
import { assertMcpToolBinding } from '../../../contracts/mcp/identity.js';
import { parseId } from '../../../contracts/identity/ids.js';
import type { McpToolCallRequest } from '../../../contracts/mcp/gateway.js';

export function snapshotContext(context: McpContext): McpContext {
  assertMcpContext(context);
  return Object.freeze({ scope: context.scope, connection: Object.freeze({ ...context.connection }) });
}

/** Approval/schema checks and dispatch must see the same arguments/binding across awaits. */
export function snapshotToolRequest(request: McpToolCallRequest): McpToolCallRequest {
  assertMcpToolBinding(request, request.tool);
  parseId('run', request.runId); parseId('tool_call', request.toolCallId);
  return Object.freeze({ ...snapshotContext(request), runId: request.runId, toolCallId: request.toolCallId,
    tool: Object.freeze({ ...request.tool }), arguments: parseJsonObject(request.arguments),
  });
}
