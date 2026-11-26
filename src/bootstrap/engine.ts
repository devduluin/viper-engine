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
import { runBudgetSelector } from './run-budget.js';
import { userMemoryOptions } from './user-memory.js';
import { SqliteMcpConnectionStore } from '../adapters/persistence/sqlite/mcp-connection-store.js';
import { isSqlitePool } from './database-dialect.js';
import { apiDatabase } from './api-database.js';

/** Concrete standalone engine. Host owns DB pool/migrations; engine owns its MCP sessions. */
export function createViperEngine(pool: SqlPool, options: ViperEngineOptions) {
  options = Object.freeze({ ...options });
  const settings = engineSettings(options);
  const modeSettings = runBudgetSelector(pool, options, settings.limits);
  const { clock, ids, connectTimeoutMs, requestTimeoutMs } = settings;
  const directory = connectionDirectory(pool);
  const connections = new McpConnectionPool({ directory, credentials: options.credentials, resolveEndpoint: options.resolveEndpoint,
    clock, connectTimeoutMs, requestTimeoutMs });
  const mcp = new PooledMcpGateway(connections, clock, requestTimeoutMs, connectTimeoutMs);
  const driver = createDurableRunDriver(pool, {
    model: settings.model.gateway, provider: settings.model.provider, mcp, validator: new JsonSchemaToolValidator(), policy: options.policy, clock, ids,
    resolveRunModel: options.resolveRunModel,
    configure: async (scope, checkpoint) => {
      const isolated = await options.isolatedTask?.(scope, checkpoint);
      if (isolated !== undefined) return { model: settings.model.model, tools: [], instructions: isolated,
        isolatedText: true, maxModelCalls: Math.min(settings.maxModelCalls, 4),
        maxOutputTokens: Math.min(settings.maxOutputTokens, 4096),
        limits: { ...settings.limits, maxTotalTokens: Math.min(settings.limits.maxTotalTokens, 24000),
          maxDurationMs: Math.min(settings.limits.maxDurationMs, 60000) }, context: settings.context };
      return { model: settings.model.model,
      maxModelCalls: settings.maxModelCalls, maxOutputTokens: settings.maxOutputTokens,
      tools: await discoverRuntimeTools(scope, await options.connections(scope, checkpoint), directory, mcp, settings),
      ...(options.instructions === undefined ? {} : { instructions: typeof options.instructions === 'function'
        ? await options.instructions(scope, checkpoint) : options.instructions }),
      limits: settings.limits, context: settings.context, toolDiscovery: settings.toolDiscovery, ...await modeSettings(checkpoint.run.id) };
    },
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
    ...(options.approvalTtlMs === undefined ? {} : { approvalTtlMs: options.approvalTtlMs }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.contextEvidence === undefined ? {} : { contextEvidence: options.contextEvidence }),
    ...userMemoryOptions(pool, options.userMemory),
    ...subAgentOptions(pool, options, clock), ...optional({ contextForModel: options.contextForModel }),
    ...(options.clientTools === undefined ? {} : { clientTools: createClientToolPort(pool, options.clientTools) }),
    ...(options.onDeliveryFailure === undefined ? {} : { onDeliveryFailure: options.onDeliveryFailure }),
  }, options.maxHistoryUserTurns);
  const onResult = options.clientTools?.onResult;
  const stopObserving = onResult === undefined ? () => undefined : processClientTools.observe(onResult);
  return engineLifecycle(driver, async () => { stopObserving(); await connections.closeAll(); });
}

/** Copies only the options a host set (exactOptionalPropertyTypes: absent stays absent). */
function optional<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Sub-agents spawn through the same database as the API, in one transaction per spawn. */
function subAgentOptions(pool: SqlPool, options: ViperEngineOptions, clock: { now(): number }) {
  // Existing children still need a restricted catalog if the host disables new delegation.
  const policy = options.subAgents ?? { profiles: [], maxDepth: 0 };
  return { subAgents: { ...policy, database: apiDatabase(pool, () => clock.now()) } };
}

function connectionDirectory(pool: SqlPool) {
  return isSqlitePool(pool) ? new SqliteMcpConnectionStore(pool) : new PostgresMcpConnectionStore(pool);
}
