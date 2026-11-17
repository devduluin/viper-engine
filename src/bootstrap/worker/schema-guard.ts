import type { WorkerHandle, WorkerStatus } from '../../application/worker/types.js';

/**
 * Runs the schema check when the worker starts. Loops start immediately (no change on a healthy
 * database); if the check fails the worker stops, `status().phase` is `failed` and `done`/`stop()`
 * reject with the check's error (e.g. SchemaNotReadyError: "run `npm run db:migrate`").
 */
export function guardWorkerSchema(host: WorkerHandle, check: () => Promise<unknown>): WorkerHandle {
  let failure: unknown;
  const failIfChecked = () => { if (failure !== undefined) throw failure; };
  // On an unmigrated database the loops may also fail ("Worker shutdown failed"); the schema error is the cause.
  const preferChecked = (error: unknown) => { failIfChecked(); throw error; };
  const done = host.done.then(failIfChecked, preferChecked);
  void done.catch(() => undefined); // Observable through done/stop, never an unhandled rejection.
  const start = () => {
    const first = host.status().phase === 'idle';
    host.start();
    if (!first) return;
    void check().catch((error: unknown) => {
      failure = error;
      void host.stop().catch(() => undefined);
    });
  };
  const status = (): WorkerStatus => (failure === undefined ? host.status() : { ...host.status(), phase: 'failed' });
  const stop = async () => { await host.stop().then(failIfChecked, preferChecked); };
  return Object.freeze({ start, stop, done, status });
}
