import { createDatabase } from '../../integration/postgres/database.js';
import { http } from '../../integration/postgres/http-fixtures.js';
import { worker } from '../../integration/postgres/worker-fixtures.js';
import { anthropic, done, seedEngineConnection } from '../../integration/postgres/engine-fixtures.js';
import type { FakeReply } from '../anthropic/fake-api.js';
import { startHttpServer } from '../mcp/harness.js';
import { engineFixture } from '../mcp/engine-fixture.js';
import { createEngineClient } from '../../../src/bootstrap/client.js';
import type { EngineModel } from '../../../src/bootstrap/configured-model.js';
import { delay } from '../../../src/shared/async/delay.js';
import type { ContextBudget } from '../../../src/contracts/context/budget.js';

interface FixtureSettings {
  readonly fetch?: typeof globalThis.fetch; readonly model?: EngineModel;
  readonly requestTimeoutMs?: number; readonly writeDelayMs?: number;
  readonly context?: Partial<ContextBudget>;
}
function delayedWrites(settings: FixtureSettings) {
  const effects = engineFixture(); const write = effects.handlers?.['record_write'];
  if (settings.writeDelayMs === undefined || write === undefined) return effects;
  const ms = settings.writeDelayMs;
  return { ...effects, handlers: { ...effects.handlers, record_write: async (args: Record<string, unknown>) => {
    const result = await write(args); await delay(ms); return result;
  } } };
}

/** Explicit loopback test DB only. Actual HTTP, worker, MCP SDK/server and model SDK with scripted fetch. */
export async function headlessFixture(replies: readonly FakeReply[] = [done], options: FixtureSettings = {}) {
  const db = await createDatabase(); const effects = delayedWrites(options); const mcp = await startHttpServer({ fixture: effects });
  const app = http(db.pool, { stream: { pollMs: 10, heartbeatMs: 500, maxStreamMs: 30000 } });
  const { api, model } = anthropic(replies);
  const connectionId = await seedEngineConnection(db.pool, mcp.url, 'headless');
  const host = worker(db.pool, options.model ?? model, { connections: async () => [{ id: connectionId, namespace: 'inv' }],
    policy: { decide: tool => tool.definition.ref.name === 'record_write' ? 'requires_approval' : 'execute' },
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.context === undefined ? {} : { context: options.context }) });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = createEngineClient({ baseUrl, getToken: async () => 'owner', requestTimeoutMs: 5000,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
  return { db, effects, api, app, host, client, baseUrl, connectionId,
    async close() { await host.stop(); await app.close(); await mcp.stop(); await db.drop(); } };
}
