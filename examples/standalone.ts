import { parseFoundationConfig, parseDatabaseConfig, createDatabasePool, parseConfiguredModelConfig,
  createConfiguredModelBinding, startEngineHost, runEngineHostUntilSignal, parseToolDiscoveryConfig } from '../src/index.js';
import { isLoopbackHost } from '../src/bootstrap/database-config.js';
import { standaloneOptions } from './standalone-options.js';

// Single-owner local starter. Existing provider adapters only; no automatic migrations/model calls.
let pool: ReturnType<typeof createDatabasePool> | undefined;
try {
  const config = parseFoundationConfig(process.env);
  if (!isLoopbackHost(config.host)) throw new Error('The local starter requires a loopback VIPER_HOST');
  const options = standaloneOptions(process.env);
  const model = createConfiguredModelBinding(parseConfiguredModelConfig(process.env), { now: () => Date.now() });
  pool = createDatabasePool(parseDatabaseConfig(process.env));
  const host = await startEngineHost(pool, { http: options.http, engine: { ...options.engine, model, toolDiscovery: parseToolDiscoveryConfig(process.env) },
    listen: { host: config.host, port: config.port } });
  console.log(JSON.stringify({ event: 'engine_listening', address: host.address }));
  await runEngineHostUntilSignal(host);
} catch {
  console.error('Engine startup/runtime failed. Check configuration and run npm run ops:check; see docs/standalone-operations.md.');
  process.exitCode = 1;
} finally { await pool?.end(); }
