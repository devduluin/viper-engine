import type { WorkerDependencies, WorkerHandle } from './types.js';
import type { WorkerOptions } from './types.js';
import { workerSettings } from './config.js';
import { WorkerState } from './state.js';
import { deliveryLoop, maintenanceLoop } from './loops.js';
import { withDeadline } from '../../shared/async/deadline.js';
import { DeadlineExceededError } from '../../shared/async/errors.js';

/** One process host; durable lease claims, not in-memory locks, establish ownership. */
export function createWorkerHost(deps: WorkerDependencies, options: WorkerOptions): WorkerHandle {
  deps = Object.freeze({ ...deps });
  const config = workerSettings(options); const shutdown = new AbortController();
  const state = new WorkerState(Object.freeze({ ...deps }), config, shutdown.signal);
  let resolveDone: (() => void) | undefined; let rejectDone: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined); // Observable through done/stop, never an unhandled background rejection.
  let loops: readonly Promise<void>[] = []; let closing: Promise<void> | undefined;
  const finish = async () => {
    const results = await Promise.allSettled([Promise.resolve().then(() => deps.engine.close()), ...loops]);
    if (results.some(result => result.status === 'rejected')) { state.phase = 'failed'; rejectDone?.(new Error('Worker shutdown failed')); }
    else { state.phase = 'stopped'; resolveDone?.(); }
  };
  const stop = (): Promise<void> => {
    if (closing !== undefined) return closing;
    state.phase = 'stopping'; shutdown.abort(); void finish();
    closing = withDeadline(() => done, { operationName: 'worker shutdown', timeoutMs: config.shutdownTimeoutMs }).catch((error: unknown) => {
      if (error instanceof DeadlineExceededError) state.stopTimedOut = true;
      throw error;
    });
    return closing;
  };
  const start = () => {
    if (state.phase === 'running') return;
    if (state.phase !== 'idle') throw new Error('A stopped worker cannot restart; construct a new host');
    state.phase = 'running';
    loops = [...Array.from({ length: config.concurrency }, (_, slot) => deliveryLoop(state, slot)), maintenanceLoop(state)];
    for (const loop of loops) void loop.catch(() => { void stop().catch(() => undefined); });
  };
  return Object.freeze({ start, stop, done, status: () => state.snapshot() });
}
