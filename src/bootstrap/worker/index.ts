import { randomUUID } from 'node:crypto';
import { parseId } from '../../contracts/identity/ids.js';
import { PostgresRunStore } from '../../adapters/persistence/postgres/run-store.js';
import { createViperEngine } from '../engine.js';
import type { ViperEngineOptions } from '../engine-types.js';
import { persistedRunInstructions } from '../http.js';
import { PostgresWorkerControl } from '../../adapters/persistence/postgres/worker-control.js';
import type { SqlPool } from '../../adapters/persistence/postgres/sql-client.js';
import type { WorkerRetryPolicy } from '../../contracts/worker/control.js';
import type { WorkerOptions, WorkerEvent } from '../../application/worker/types.js';
import { createWorkerHost } from '../../application/worker/host.js';
import { workerFailureCode } from './failures.js';
import { workerInstructions } from './instructions.js';
import { deadLetter, parseMaxDeliveryFailures } from './dead-letter.js';
export type { WorkerEvent, WorkerHandle, WorkerStatus } from '../../application/worker/types.js';

export interface EngineWorkerOptions extends Omit<WorkerOptions, 'workerId'> {
  readonly workerId?: string; readonly retry?: Partial<WorkerRetryPolicy>;
  /** Consecutive failed deliveries before the run ends as `failed` (default 20). */
  readonly maxDeliveryFailures?: number;
  readonly onEvent?: (event: WorkerEvent) => void | Promise<void>;
}

/** Shared API/engine DB; host owns migrations/pool. Factory owns this engine's MCP sessions. */
export function createEngineWorker(pool: SqlPool, engineOptions: Omit<ViperEngineOptions, 'onDeliveryFailure'>, options: EngineWorkerOptions = {}) {
  options = Object.freeze({ ...options }); engineOptions = Object.freeze({ ...engineOptions });
  const clock = engineOptions.clock ?? { now: () => Date.now() };
  const maxFailures = parseMaxDeliveryFailures(options.maxDeliveryFailures);
  const ids = engineOptions.ids ?? { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };
  const runs = new PostgresRunStore(pool);
  const control = new PostgresWorkerControl(pool, { baseMs: 1000, maxMs: 300000, authenticationMs: 30000, ...options.retry });
  const saved = persistedRunInstructions(pool); const configured = engineOptions.instructions;
  const engine = createViperEngine(pool, { ...engineOptions, clock,
    instructions: workerInstructions(configured, saved),
    onDeliveryFailure: async (claim, error) => {
      const deferred = await control.defer(claim, workerFailureCode(error));
      if (deferred.ok && deferred.value.failures >= maxFailures) await deadLetter(runs, claim, clock, ids);
    },
  });
  return createWorkerHost({ engine, clock, maintain: limit => control.maintain(limit), classify: workerFailureCode,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }) },
  { ...options, workerId: options.workerId ?? `worker-${randomUUID()}` });
}
