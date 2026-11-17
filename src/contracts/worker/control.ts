import type { RunClaim } from '../state/leases.js';
import type { StateResult } from '../state/result.js';

export type WorkerFailureCode = 'authentication_required' | 'connection_unavailable' | 'invalid_configuration' | 'execution_failure';
export interface WorkerRetryPolicy {
  readonly baseMs: number; readonly maxMs: number; readonly authenticationMs: number;
}
export interface WorkerControl {
  /** Persist only under the failed holder's live lease; never borrow another generation. */
  defer(claim: RunClaim, code: WorkerFailureCode): Promise<StateResult<{ readonly failures: number; readonly availableAt: number }>>;
  /** Expire due approvals and wake eligible waiting runs atomically under run-first locks. */
  maintain(limit: number): Promise<number>;
}
export interface WorkerDelivery {
  readonly kind: 'idle' | 'yielded' | 'settled'; readonly runId?: string; readonly status?: string; readonly reason?: string;
}
export interface WorkerEngine {
  runOnce(workerId: string, shutdown?: AbortSignal): Promise<WorkerDelivery>;
  close(): Promise<void>;
}
