import type { SqlPool } from '../../adapters/persistence/postgres/sql-client.js';
import { assertSchemaReady } from '../database.js';
import { createEngineHttpServer } from '../http.js';
import type { EngineHttpOptions } from '../http.js';
import type { ViperEngineOptions } from '../engine-types.js';
import { createEngineWorker } from '../worker/index.js';
import type { EngineWorkerOptions } from '../worker/index.js';
import { createReadiness } from './readiness.js';

export interface EngineHostOptions {
  readonly engine: Omit<ViperEngineOptions, 'onDeliveryFailure'>;
  readonly http: Omit<EngineHttpOptions, 'schemaCheck'>;
  readonly worker?: Omit<EngineWorkerOptions, 'schemaCheck'>;
  readonly listen: { readonly host: string; readonly port: number };
  readonly readinessTimeoutMs?: number;
}

/** Host owns HTTP/worker; caller owns the DB pool. No migrations or provider probes on startup. */
export async function startEngineHost(pool: SqlPool, options: EngineHostOptions) {
  await assertSchemaReady(pool);
  const worker = createEngineWorker(pool, options.engine, { ...options.worker, schemaCheck: false });
  const app = createEngineHttpServer(pool, options.http);
  let draining = false; let workerFailed = false; let closing: Promise<void> | undefined;
  let resolveDone!: () => void; let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined);
  const readiness = createReadiness(() => assertSchemaReady(pool), () => worker.status(), () => draining, options.readinessTimeoutMs);
  // Inherit the API's bearer authentication and no-store policy; no diagnostic secrets in responses.
  app.get('/health/live', async () => ({ status: 'alive' }));
  app.get('/health/ready', async (_request, reply) => {
    const result = await readiness(); return reply.code(result.ready ? 200 : 503).send(result);
  });
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    draining = true;
    closing = (async () => {
      const results = await Promise.allSettled([app.close(), worker.stop()]);
      if (workerFailed || results.some(result => result.status === 'rejected')) throw new Error('Engine host shutdown failed');
    })();
    void closing.then(resolveDone, rejectDone);
    return closing;
  };
  try {
    const address = await app.listen({ ...options.listen });
    worker.start();
    void worker.done.then(close, () => { workerFailed = true; return close(); }).catch(rejectDone);
    return Object.freeze({ address, close, done, readiness, workerStatus: () => worker.status() });
  } catch (error) { await close().catch(() => undefined); throw error; }
}
