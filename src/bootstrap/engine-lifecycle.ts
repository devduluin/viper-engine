import type { DurableRunDriver } from '../application/durable/driver.js';
import type { DriverResult } from '../application/durable/types.js';

/** Shutdown belongs to the engine host, never an HTTP/client disconnect. */
export function engineLifecycle(driver: DurableRunDriver, dispose: () => Promise<void>) {
  const shutdown = new AbortController();
  const active = new Set<Promise<DriverResult>>();
  let closing: Promise<void> | undefined;
  const runOnce = async (workerId: string, signal?: AbortSignal): Promise<DriverResult> => {
    if (shutdown.signal.aborted) return { kind: 'idle' };
    const combined = signal === undefined ? shutdown.signal : AbortSignal.any([shutdown.signal, signal]);
    const work = driver.runOnce(workerId, combined);
    active.add(work);
    try { return await work; } finally { active.delete(work); }
  };
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    shutdown.abort();
    closing = Promise.allSettled([dispose(), ...active]).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('Engine shutdown failed');
    });
    return closing;
  };
  return Object.freeze({ runOnce, close });
}
