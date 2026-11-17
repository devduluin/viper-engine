import { parseId } from '../../../src/contracts/identity/ids.js';
import { scopeFromAuthenticatedIdentity } from '../../../src/contracts/identity/scope.js';
import { parseMessageHistory } from '../../../src/contracts/messages/history.js';
import type { ModelCapabilities, ModelRequest } from '../../../src/contracts/models/gateway.js';
import type { McpContext } from '../../../src/contracts/mcp/identity.js';
import type { McpToolCallRequest } from '../../../src/contracts/mcp/gateway.js';

export const modelCapabilities: ModelCapabilities = {
  toolCalling: true, streaming: true, structuredOutput: true,
  contentTypes: ['text', 'json', 'image', 'audio'],
};

export function context(): McpContext {
  return {
    scope: scopeFromAuthenticatedIdentity({ actorId: parseId('actor', 'actor-1'), appId: parseId('app', 'app-1') }),
    connection: { id: parseId('mcp_connection', 'connection-1'), serverId: parseId('mcp_server', 'server-1') },
  };
}

export function modelRequest(): ModelRequest {
  return {
    scope: context().scope,
    conversationId: parseId('conversation', 'conversation-1'), runId: parseId('run', 'run-1'),
    stepId: parseId('step', 'step-1'), modelCallId: parseId('model_call', 'model-call-1'),
    model: 'fixture-model', maxOutputTokens: 100, deadlineAt: 1000,
    messages: parseMessageHistory([{ id: 'message-1', role: 'user', content: [{ type: 'text', text: 'Get stock' }] }]),
    tools: [{ name: 'inventory_lookup', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }],
  };
}

export function toolRequest(): McpToolCallRequest {
  const base = context();
  return {
    ...base, runId: parseId('run', 'run-1'), toolCallId: parseId('tool_call', 'call-1'),
    tool: { connectionId: base.connection.id, serverId: base.connection.serverId, name: 'lookup', definitionVersion: 'v1' },
    arguments: { id: 'item-1' },
  };
}
