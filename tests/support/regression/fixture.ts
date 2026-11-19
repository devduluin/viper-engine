import { createDatabase, MIGRATIONS_DIR } from '../../integration/postgres/database.js';
import { http } from '../../integration/postgres/http-fixtures.js';
import { engineOptions, seedEngineConnection } from '../../integration/postgres/engine-fixtures.js';
import { engineFixture } from '../mcp/engine-fixture.js';
import { fixtureTools } from '../mcp/fixture-server.js';
import { startHttpServer } from '../mcp/harness.js';
import { createEngineClient } from '../../../src/bootstrap/client.js';
import { createViperEngine } from '../../../src/bootstrap/engine.js';
import { engineSettings } from '../../../src/bootstrap/engine-config.js';
import { regressionModel } from './model.js';
import type { EngineCase } from './cases.js';
import { loadMigrations } from '../../../src/adapters/persistence/postgres/migrate.js';

async function dispose(cleanup: readonly (() => Promise<unknown>)[]) {
  const errors: unknown[] = [];
  for (const close of [...cleanup].reverse()) { try { await close(); } catch (error) { errors.push(error); } }
  if (errors.length > 0) throw new AggregateError(errors, 'Regression fixture cleanup failed');
}

export async function regressionFixture(scenario: EngineCase) {
  const cleanup: (() => Promise<unknown>)[] = [];
  const db = await createDatabase(); cleanup.push(() => db.drop());
  try {
  const effects = engineFixture(); let catalogPages = 0;
  const originalWrite = effects.handlers!['record_write']!;
  const fixture = { ...effects, onListTools: () => { catalogPages++; },
    extraTools: [...effects.extraTools!, { name: 'empty_rows', description: 'Return a valid empty collection', inputSchema: { type: 'object' as const } }],
    handlers: { ...effects.handlers, empty_rows: () => ({ content: [], structuredContent: { rows: [] } }),
      record_write: async (args: Record<string, unknown>) => {
        const result = await originalWrite(args);
        if (scenario.unknownWrite === true) return new Promise<never>(() => undefined);
        return result;
      } },
  };
  const mcp = await startHttpServer({ fixture }); cleanup.push(() => mcp.stop());
  const app = http(db.pool); cleanup.push(() => app.close());
  const script = regressionModel(scenario);
  const connectionId = await seedEngineConnection(db.pool, mcp.url, 'regression');
  const options = engineOptions(connectionId, script.model, { requestTimeoutMs: 1500 });
  const engine = createViperEngine(db.pool, options); cleanup.push(() => engine.close()); const settings = engineSettings(options);
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = createEngineClient({ baseUrl, getToken: async () => 'owner' });
  const version = await db.pool.query('SHOW server_version');
  const migrations = (await loadMigrations(MIGRATIONS_DIR)).map(migration => ({ version: migration.version, checksum: migration.checksum }));
  const configuration = { provider: script.model.provider, model: script.model.model, modelProvenance: script.provenance,
    settings: scenario.control === 'input' ? { source: 'fixed-port-decisions' } : { effort: 'low', fallbacks: true, sdkRetries: 0 },
    policy: 'record_write_requires_exact_approval_other_tools_execute',
    context: settings.context, limits: settings.limits, maxModelCalls: settings.maxModelCalls, maxOutputTokens: settings.maxOutputTokens,
    connectTimeoutMs: settings.connectTimeoutMs, requestTimeoutMs: settings.requestTimeoutMs, discoveryTimeoutMs: settings.timeoutMs,
    leaseMs: options.leaseMs, heartbeatMs: options.heartbeatMs, transport: 'loopback-streamable-http', endpoint: mcp.url,
    database: { version: String(version.rows[0]?.server_version), migrations }, catalog: fixtureTools(fixture) };
  return { db, app, engine, client, effects, script, configuration, catalogPages: () => catalogPages,
    close: () => dispose(cleanup) };
  } catch (error) {
    try { await dispose(cleanup); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Regression setup/cleanup failed'); }
    throw error;
  }
}
export type RegressionFixture = Awaited<ReturnType<typeof regressionFixture>>;
