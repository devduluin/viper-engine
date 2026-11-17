import type { WorkerHandle } from '../../application/worker/types.js';

interface Signals {
  on(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/** Explicit executable-host helper; importing the library never installs process handlers. */
export async function runWorkerUntilSignal(worker: WorkerHandle, signals: Signals = process): Promise<void> {
  const stop = () => { void worker.stop().catch(() => undefined); };
  signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
  try { worker.start(); await worker.done; }
  finally { signals.removeListener('SIGINT', stop); signals.removeListener('SIGTERM', stop); }
}
