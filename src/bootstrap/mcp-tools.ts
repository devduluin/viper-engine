import type { Clock } from '../contracts/identity/ports.js';
import type { TrustedScope } from '../contracts/identity/scope.js';
import type { McpConnectionDirectory } from '../contracts/mcp/access.js';
import type { McpGateway } from '../contracts/mcp/gateway.js';
import type { McpConnectionId } from '../contracts/mcp/identity.js';
import type { McpToolDefinition } from '../contracts/mcp/catalog.js';
import type { RuntimeTool } from '../agent/execution/tool-catalog.js';
import { indexTools } from '../agent/execution/tool-catalog.js';
import { namespaceTools } from '../adapters/mcp/client/aliases.js';
import { withDeadline } from '../shared/async/deadline.js';
import { createFingerprint } from '../shared/fingerprints/fingerprint.js';

export interface ConnectionBinding { readonly id: McpConnectionId; readonly namespace?: string }
export class EngineSetupError extends Error {
  constructor(readonly code: 'invalid_catalog' | 'not_found' | 'permission' | 'authentication_required' | 'connection_unavailable') {
    super(`Engine setup failed: ${code}`); this.name = 'EngineSetupError';
  }
}

export interface DiscoveryOptions {
  readonly clock: Clock; readonly timeoutMs: number;
  readonly maxConnections: number; readonly maxPages: number; readonly maxTools: number;
}

function namespace(binding: ConnectionBinding): string {
  return binding.namespace ?? `m${createFingerprint({ id: binding.id }, { domain: 'viper.mcp.namespace', version: '1' }).slice(0, 12)}`;
}

function validateBindings(bindings: readonly ConnectionBinding[], maximum: number): void {
  if (bindings.length > maximum) throw new EngineSetupError('invalid_catalog');
  const ids = new Set<string>(); const names = new Set<string>();
  for (const binding of bindings) {
    const prefix = namespace(binding);
    if (!/^[a-z][a-z0-9]{0,15}$/.test(prefix) || ids.has(binding.id) || names.has(prefix)) throw new EngineSetupError('invalid_catalog');
    ids.add(binding.id); names.add(prefix);
  }
}

/** Re-discovered per delivery from authorized connections; model output cannot select endpoints. */
export async function discoverRuntimeTools(scope: TrustedScope, selected: readonly ConnectionBinding[],
  directory: McpConnectionDirectory, gateway: McpGateway, options: DiscoveryOptions): Promise<readonly RuntimeTool[]> {
  const bindings = selected.map(binding => Object.freeze({ ...binding }));
  validateBindings(bindings, options.maxConnections);
  const tools = await withDeadline(async signal => {
    const tools: RuntimeTool[] = [];
    for (const binding of bindings) {
      const record = await directory.get(scope, binding.id);
      if (!record.ok) throw new EngineSetupError('not_found');
      const context = { scope, connection: record.value.connection };
      const definitions = await pages(context, gateway, options, signal);
      if (definitions.length > options.maxTools - tools.length) throw new EngineSetupError('invalid_catalog');
      tools.push(...namespaceTools(namespace(binding), definitions).map(tool => Object.freeze({ ...tool, context })));
    }
    return Object.freeze(tools);
  }, { operationName: 'MCP discovery', timeoutMs: options.timeoutMs });
  indexTools(tools, scope); // Reject ambiguous aliases/definitions before the model is called.
  return tools;
}

async function pages(context: Parameters<McpGateway['listTools']>[0], gateway: McpGateway, options: DiscoveryOptions,
  signal: AbortSignal): Promise<readonly McpToolDefinition[]> {
  const tools: McpToolDefinition[] = []; const seen = new Set<string>();
  let cursor: string | undefined;
  const deadlineAt = options.clock.now() + options.timeoutMs;
  for (let page = 0; page < options.maxPages; page += 1) {
    const result = await gateway.listTools({ ...context, ...(cursor === undefined ? {} : { cursor }) }, { signal, deadlineAt });
    if (!result.ok) {
      const code = result.error.code;
      throw new EngineSetupError(code === 'authentication_required' || code === 'permission' || code === 'not_found' ? code : 'connection_unavailable');
    }
    if (result.value.items.length > options.maxTools - tools.length) throw new EngineSetupError('invalid_catalog');
    tools.push(...result.value.items);
    cursor = result.value.nextCursor;
    if (cursor === undefined) return tools;
    if (seen.has(cursor)) throw new EngineSetupError('invalid_catalog');
    seen.add(cursor);
  }
  throw new EngineSetupError('invalid_catalog');
}
