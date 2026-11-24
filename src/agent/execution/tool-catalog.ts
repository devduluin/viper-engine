import { parseJsonObject } from '../../contracts/messages/json.js';
import { assertSameScope } from '../../contracts/identity/scope.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { McpToolDefinition } from '../../contracts/mcp/catalog.js';
import type { McpContext } from '../../contracts/mcp/identity.js';
import { assertMcpToolBinding, mcpToolKey } from '../../contracts/mcp/identity.js';
import type { ModelToolDefinition } from '../../contracts/models/gateway.js';

/**
 * One authorized MCP tool offered to the model under an application-chosen alias.
 * Alias assignment/namespacing belongs to discovery (P05-02); the runtime only maps exact aliases.
 */
export interface RuntimeTool {
  readonly alias: string;
  readonly definition: McpToolDefinition;
  readonly context: McpContext;
  readonly untrustedOutput?: boolean;
}

export interface ToolIndex {
  readonly modelTools: readonly ModelToolDefinition[];
  find(alias: string): RuntimeTool | undefined;
}

function modelTool(tool: RuntimeTool): ModelToolDefinition {
  const description = tool.definition.description;
  return Object.freeze({
    name: tool.alias,
    inputSchema: parseJsonObject(tool.definition.inputSchema),
    ...(description === undefined ? {} : { description }),
  });
}

/** Rejects empty/duplicate aliases, duplicate definitions and context/tool binding mismatches. */
export function indexTools(tools: readonly RuntimeTool[], scope?: TrustedScope): ToolIndex {
  const byAlias = new Map<string, RuntimeTool>();
  const refs = new Set<string>();
  for (const tool of tools) {
    if (tool.alias.trim().length === 0 || tool.alias !== tool.alias.trim()) throw new Error('Invalid tool alias');
    if (byAlias.has(tool.alias)) throw new Error(`Duplicate tool alias: ${tool.alias}`);
    assertMcpToolBinding(tool.context, tool.definition.ref);
    if (scope !== undefined) assertSameScope(scope, tool.context.scope);
    const key = mcpToolKey(tool.definition.ref);
    if (refs.has(key)) throw new Error('The same MCP tool is offered under two aliases');
    refs.add(key);
    byAlias.set(tool.alias, snapshotTool(tool));
  }
  const modelTools = Object.freeze([...byAlias.values()].map(modelTool));
  return Object.freeze({ modelTools, find: (alias: string) => byAlias.get(alias) });
}

function snapshotTool(tool: RuntimeTool): RuntimeTool {
  return Object.freeze({
    alias: tool.alias,
    ...(tool.untrustedOutput ? { untrustedOutput: true } : {}),
    context: Object.freeze({ scope: tool.context.scope, connection: Object.freeze({ ...tool.context.connection }) }),
    definition: Object.freeze({
      ...tool.definition, ref: Object.freeze({ ...tool.definition.ref }),
      inputSchema: parseJsonObject(tool.definition.inputSchema),
      ...(tool.definition.outputSchema === undefined ? {} : { outputSchema: parseJsonObject(tool.definition.outputSchema) }),
      ...(tool.definition.annotations === undefined ? {} : { annotations: Object.freeze({ ...tool.definition.annotations }) }),
    }),
  });
}
