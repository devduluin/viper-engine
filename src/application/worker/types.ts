import type { Clock } from '../../contracts/identity/ports.js';
import type { WorkerEngine, WorkerDelivery, WorkerFailureCode } from '../../contracts/worker/control.js';

export interface WorkerOptions {
  readonly workerId: string; readonly concurrency?: number; readonly pollMs?: number;
  readonly maintenanceMs?: number; readonly maintenanceBatch?: number;
  readonly errorBackoffMs?: number; readonly maxErrorBackoffMs?: number;
  readonly shutdownTimeoutMs?: number; readonly observerTimeoutMs?: number;
}
export type WorkerEvent =
  | { readonly type: 'delivery'; readonly slot: number; readonly result: WorkerDelivery }
  | { readonly type: 'failure'; readonly slot?: number; readonly code: WorkerFailureCode }
  | { readonly type: 'maintenance'; readonly woken: number };
export interface WorkerDependencies {
  readonly engine: WorkerEngine; readonly clock: Clock;
  readonly maintain: (limit: number) => Promise<number>;
  readonly classify: (error: unknown) => WorkerFailureCode;
  readonly onEvent?: (event: WorkerEvent) => void | Promise<void>;
}
export interface WorkerStatus {
  readonly phase: 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
  readonly active: number; readonly maxActive: number;
  readonly settled: number; readonly yielded: number; readonly idlePolls: number; readonly failures: number;
  readonly maintenanceWoken: number; readonly maintenanceFailures: number; readonly observerFailures: number;
  readonly stopTimedOut: boolean; readonly lastActivityAt?: number;
}
export interface WorkerHandle {
  start(): void; stop(): Promise<void>; readonly done: Promise<void>; status(): WorkerStatus;
}
