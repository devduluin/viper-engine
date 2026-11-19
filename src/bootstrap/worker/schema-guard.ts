import type { WorkerHandle, WorkerStatus } from '../../application/worker/types.js';

/** No claims, maintenance or provider setup may begin before the asynchronous schema check passes. */
export function guardWorkerSchema(host: WorkerHandle, check: () => Promise<unknown>): WorkerHandle {
  let phase: WorkerStatus['phase'] = 'idle'; let stopped = false; let failure: unknown;
  let closing: Promise<void> | undefined;
  let resolveDone!: () => void; let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined);
  void host.done.then(resolveDone, rejectDone);
  const stop = (): Promise<void> => {
    if (closing !== undefined) return closing;
    stopped = true;
    closing = (async () => {
      await host.stop().catch((error: unknown) => { if (failure !== undefined) throw failure; throw error; });
      if (failure !== undefined) throw failure;
    })();
    return closing;
  };
  const start = () => {
    if (phase === 'running' && !stopped) return;
    if (phase !== 'idle' || stopped) throw new Error('A stopped worker cannot restart; construct a new host');
    phase = 'running';
    void Promise.resolve().then(() => stopped ? undefined : check()).then(() => { if (!stopped) host.start(); }).catch(async (error: unknown) => {
      if (stopped) return;
      failure = error; phase = 'failed';
      rejectDone(error);
      await host.stop().catch(() => undefined);
    });
  };
  const status = (): WorkerStatus => {
    if (failure !== undefined) return { ...host.status(), phase: 'failed' };
    if (host.status().phase === 'idle' && phase === 'running') return { ...host.status(), phase: stopped ? 'stopping' : 'running' };
    return host.status();
  };
  return Object.freeze({ start, stop, done, status });
}
