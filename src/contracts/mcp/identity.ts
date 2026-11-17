import { parseId } from '../identity/ids.js';
import type { EntityId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import { assertTrustedScope } from '../identity/scope.js';

export type McpConnectionId = EntityId<'mcp_connection'>;
export type McpServerId = EntityId<'mcp_server'>;

export interface McpConnectionRef {
  readonly id: McpConnectionId;
  readonly serverId: McpServerId;
}

export interface McpContext {
  readonly scope: TrustedScope;
  readonly connection: McpConnectionRef;
}

export interface McpToolRef {
  readonly connectionId: McpConnectionId;
  readonly serverId: McpServerId;
  readonly name: string;
  readonly definitionVersion: string;
}

/** Collision-free tuple key, not a hash, permission token or provider-facing alias. */
export function mcpToolKey(ref: McpToolRef): string {
  parseId('mcp_connection', ref.connectionId);
  parseId('mcp_server', ref.serverId);
  if (!ref.name.trim() || !ref.definitionVersion.trim()) throw new Error('Tool name and definition version are required');
  return JSON.stringify([ref.connectionId, ref.serverId, ref.name, ref.definitionVersion]);
}

export function assertMcpContext(context: McpContext): void {
  assertTrustedScope(context.scope);
  parseId('mcp_connection', context.connection.id);
  parseId('mcp_server', context.connection.serverId);
}

export function assertMcpToolBinding(context: McpContext, tool: McpToolRef): void {
  assertMcpContext(context);
  mcpToolKey(tool);
  if (context.connection.id !== tool.connectionId || context.connection.serverId !== tool.serverId) {
    throw new Error('MCP tool connection/server mismatch');
  }
}
