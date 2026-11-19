import { McpConnectionPool } from '../adapters/mcp/client/connection-pool.js';
import { PooledMcpGateway } from '../adapters/mcp/client/pooled-gateway.js';
import { PostgresMcpConnectionStore } from '../adapters/persistence/postgres/mcp-connection-store.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { JsonSchemaToolValidator } from '../adapters/validation/tool-schema.js';
import { createDurableRunDriver } from './durable.js';
import { discoverRuntimeTools } from './mcp-tools.js';
import type { ViperEngineOptions } from './engine-types.js';
import { engineSettings } from './engine-config.js';
import { engineLifecycle } from './engine-lifecycle.js';
import { createClientToolPort } from './client-tools.js';
import { processClientTools } from '../application/streaming/client-tools.js';

/** Concrete standalone engine. Host owns DB pool/migrations; engine owns its MCP sessions. */
export function createViperEngine(pool: SqlPool, options: ViperEngineOptions) {
  options = Object.freeze({ ...options });
  const settings = engineSettings(options);
  const { clock, ids, connectTimeoutMs, requestTimeoutMs } = settings;
  const directory = new PostgresMcpConnectionStore(pool);
  const connections = new McpConnectionPool({ directory, credentials: options.credentials, resolveEndpoint: options.resolveEndpoint,
    clock, connectTimeoutMs, requestTimeoutMs });
  const mcp = new PooledMcpGateway(connections, clock, requestTimeoutMs, connectTimeoutMs);
  const driver = createDurableRunDriver(pool, {
    model: settings.model.gateway, provider: settings.model.provider, mcp, validator: new JsonSchemaToolValidator(), policy: options.policy, clock, ids,
    configure: async (scope, checkpoint) => ({ model: settings.model.model,
      maxModelCalls: settings.maxModelCalls, maxOutputTokens: settings.maxOutputTokens,
      tools: await discoverRuntimeTools(scope, await options.connections(scope, checkpoint), directory, mcp, settings),
      ...(options.instructions === undefined ? {} : { instructions: typeof options.instructions === 'function'
        ? await options.instructions(scope, checkpoint) : options.instructions }),
      limits: settings.limits, context: settings.context, toolDiscovery: settings.toolDiscovery }),
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
    ...(options.approvalTtlMs === undefined ? {} : { approvalTtlMs: options.approvalTtlMs }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.contextEvidence === undefined ? {} : { contextEvidence: options.contextEvidence }),
    ...(options.clientTools === undefined ? {} : { clientTools: createClientToolPort(pool, options.clientTools) }),
    ...(options.onDeliveryFailure === undefined ? {} : { onDeliveryFailure: options.onDeliveryFailure }),
  });
  const onResult = options.clientTools?.onResult;
  const stopObserving = onResult === undefined ? () => undefined : processClientTools.observe(onResult);
  return engineLifecycle(driver, async () => { stopObserving(); await connections.closeAll(); });
}
