import type { ClientToolPort } from '../agent/runtime/types.js';
import { CLIENT_TOOL_PREFIX } from '../agent/runtime/client-tools.js';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { processClientTools, type ClientToolBroker } from '../application/streaming/client-tools.js';
import type { ClientToolsConfig } from './engine-types.js';

const NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Client tools for the worker: a run is offered the configured tools it asked for at start
 * (runs.client_tools); invocation waits on the process broker for the client's answer.
 */
export function createClientToolPort(pool: SqlPool, config: ClientToolsConfig, broker: ClientToolBroker = processClientTools): ClientToolPort {
  const definitions = config.definitions.filter(definition => NAME.test(definition.name));
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 20_000, 1_000), 120_000);
  return {
    async definitions(runId) {
      const result = await pool.query('SELECT client_tools FROM viper_engine.runs WHERE id = $1', [runId]);
      const wanted = (result.rows[0] as { client_tools?: unknown } | undefined)?.client_tools;
      if (!Array.isArray(wanted) || wanted.length === 0) return [];
      return definitions.filter(definition => wanted.includes(definition.name)).map(definition => ({
        name: `${CLIENT_TOOL_PREFIX}${definition.name}`, description: definition.description, inputSchema: definition.inputSchema }));
    },
    invoke: (call, signal) => broker.request(call, timeoutMs, signal),
  };
}
