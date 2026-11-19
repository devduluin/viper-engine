import { withDeadline } from '../../shared/async/deadline.js';
import { assertTimerDuration } from '../../shared/async/delay.js';
import { SchemaNotReadyError } from '../database.js';
import type { WorkerStatus } from '../../application/worker/types.js';

export type ReadinessCode = 'ready' | 'draining' | 'worker_unavailable' | 'schema_not_ready' | 'database_unavailable';
export interface Readiness { readonly ready: boolean; readonly code: ReadinessCode }

/** Single flight bounds outstanding probes even when a timed-out DB operation cannot be cancelled. */
export function createReadiness(check: () => Promise<unknown>, worker: () => WorkerStatus,
  draining: () => boolean, timeoutMs = 2000): () => Promise<Readiness> {
  assertTimerDuration('readiness timeout', timeoutMs);
  let pending: Promise<unknown> | undefined;
  const state = (): ReadinessCode => {
    if (draining()) return 'draining';
    return worker().phase === 'running' ? 'ready' : 'worker_unavailable';
  };
  const result = (code: ReadinessCode): Readiness => ({ ready: code === 'ready', code });
  return async () => {
    const before = state(); if (before !== 'ready') return result(before);
    if (pending === undefined) {
      pending = Promise.resolve().then(check).finally(() => { pending = undefined; });
      void pending.catch(() => undefined);
    }
    const current = pending;
    try {
      await withDeadline(() => current, { operationName: 'readiness', timeoutMs });
      return result(state());
    } catch (error) {
      return result(error instanceof SchemaNotReadyError ? 'schema_not_ready' : 'database_unavailable');
    }
  };
}
