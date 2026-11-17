import assert from 'node:assert/strict';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { delay } from '../../../src/shared/async/delay.js';
import { createEngineWorker } from '../../../src/bootstrap/worker/index.js';
import type { EngineWorkerOptions } from '../../../src/bootstrap/worker/index.js';
import type { ViperEngineOptions } from '../../../src/bootstrap/engine-types.js';
import type { EngineModel } from '../../../src/bootstrap/configured-model.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';

export async function until(check: () => Promise<boolean> | boolean, name = 'worker condition'): Promise<void> {
  await withDeadline(async signal => {
    while (!signal.aborted) { if (await check()) return; await delay(20, { signal }); }
    throw signal.reason;
  }, { operationName: name, timeoutMs: 15000 });
}

export function worker(pool: SqlPool, model: EngineModel, engine: Partial<ViperEngineOptions> = {}, host: EngineWorkerOptions = {}) {
  return createEngineWorker(pool, { model,
    credentials: { resolve: async () => ({ ok: true, credential: { kind: 'none' } }),
      refresh: async () => ({ ok: false, code: 'authentication_required' }) },
    resolveEndpoint: server => ({ kind: 'streamable_http', url: server.endpointRef }), connections: async () => [],
    policy: { decide: () => 'execute' }, leaseMs: 3000, heartbeatMs: 300, limits: { maxDurationMs: 30000 }, ...engine,
  }, { concurrency: 1, pollMs: 20, maintenanceMs: 100, errorBackoffMs: 20, shutdownTimeoutMs: 10000, ...host });
}

export async function runStatus(pool: SqlPool, id: string): Promise<string> {
  const result = await pool.query('SELECT status FROM viper_engine.runs WHERE id = $1', [id]);
  assert.ok(result.rows[0]); return String(Reflect.get(Object(result.rows[0]), 'status'));
}
