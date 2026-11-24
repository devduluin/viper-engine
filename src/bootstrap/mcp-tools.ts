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

export interface ConnectionBinding {
  readonly id: McpConnectionId;
  readonly namespace?: string;
  readonly allowTool?: (name: string) => boolean;
  readonly untrustedOutput?: boolean;
  /** An optional integration may be unavailable without blocking the app's built-in tools. */
  readonly optionalTimeoutMs?: number;
}
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
  const required = bindings.filter(binding => binding.optionalTimeoutMs === undefined);
  const optional = bindings.filter(binding => binding.optionalTimeoutMs !== undefined);
  const tools = await withDeadline(async signal => {
    const tools: RuntimeTool[] = [];
    for (const binding of required) {
      const found = await discoverBinding(scope, binding, directory, gateway, options, signal);
      if (found.length > options.maxTools - tools.length) throw new EngineSetupError('invalid_catalog');
      tools.push(...found);
    }
    return tools;
  }, { operationName: 'MCP discovery', timeoutMs: options.timeoutMs });
  const extras = await Promise.all(optional.map(binding => discoverBinding(scope, binding, directory, gateway, options)));
  for (const found of extras) {
    if (found.length <= options.maxTools - tools.length) tools.push(...found);
  }
  const sorted = Object.freeze(sortByAlias(tools));
  indexTools(sorted, scope); // Reject ambiguous aliases/definitions before the model is called.
  return sorted;
}

async function discoverBinding(scope: TrustedScope, binding: ConnectionBinding, directory: McpConnectionDirectory,
  gateway: McpGateway, options: DiscoveryOptions, signal?: AbortSignal): Promise<readonly RuntimeTool[]> {
  const discover = async (discoverySignal: AbortSignal, settings: DiscoveryOptions) => {
    const record = await directory.get(scope, binding.id);
    if (!record.ok) throw new EngineSetupError('not_found');
    const context = { scope, connection: record.value.connection };
    const definitions = await pages(context, gateway, settings, discoverySignal, binding.allowTool);
    return namespaceTools(namespace(binding), definitions).map(tool => Object.freeze({
      ...tool, context, ...(binding.untrustedOutput ? { untrustedOutput: true } : {}),
    }));
  };
  if (signal !== undefined) return discover(signal, options);
  const timeoutMs = Math.min(binding.optionalTimeoutMs ?? options.timeoutMs, options.timeoutMs);
  try {
    return await withDeadline(inner => discover(inner, { ...options, timeoutMs }),
      { operationName: 'Optional MCP discovery', timeoutMs });
  } catch { return []; }
}

/**
 * Deterministic catalog order: the tool list is the first part of a provider prompt, so connection
 * or page order must not change its bytes (prompt-cache prefix). Code-point order, not locale order.
 */
export function sortByAlias<T extends { readonly alias: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

async function pages(context: Parameters<McpGateway['listTools']>[0], gateway: McpGateway, options: DiscoveryOptions,
  signal: AbortSignal, allowTool: (name: string) => boolean = () => true): Promise<readonly McpToolDefinition[]> {
  const tools: McpToolDefinition[] = []; const seen = new Set<string>();
  let cursor: string | undefined;
  const deadlineAt = options.clock.now() + options.timeoutMs;
  for (let page = 0; page < options.maxPages; page += 1) {
    const result = await gateway.listTools({ ...context, ...(cursor === undefined ? {} : { cursor }) }, { signal, deadlineAt });
    if (!result.ok) throw discoveryError(result.error.code);
    const allowed = result.value.items.filter(tool => allowTool(tool.ref.name));
    if (allowed.length > options.maxTools - tools.length) throw new EngineSetupError('invalid_catalog');
    tools.push(...allowed);
    cursor = result.value.nextCursor;
    if (cursor === undefined) return tools;
    if (seen.has(cursor)) throw new EngineSetupError('invalid_catalog');
    seen.add(cursor);
  }
  throw new EngineSetupError('invalid_catalog');
}

function discoveryError(code: string) {
  return new EngineSetupError(code === 'authentication_required' || code === 'permission' || code === 'not_found'
    ? code : 'connection_unavailable');
}
