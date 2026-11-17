import type { WorkerDependencies, WorkerEvent, WorkerStatus } from './types.js';
import type { WorkerSettings } from './config.js';
import { withDeadline } from '../../shared/async/deadline.js';

export class WorkerState {
  phase: WorkerStatus['phase'] = 'idle';
  active = 0; maxActive = 0; settled = 0; yielded = 0; idlePolls = 0; failures = 0;
  maintenanceWoken = 0; maintenanceFailures = 0; observerFailures = 0; stopTimedOut = false;
  lastActivityAt: number | undefined;

  constructor(readonly deps: WorkerDependencies, readonly config: WorkerSettings, readonly signal: AbortSignal) {}

  snapshot(): WorkerStatus {
    return Object.freeze({ phase: this.phase, active: this.active, maxActive: this.maxActive, settled: this.settled,
      yielded: this.yielded, idlePolls: this.idlePolls, failures: this.failures, maintenanceWoken: this.maintenanceWoken,
      maintenanceFailures: this.maintenanceFailures, observerFailures: this.observerFailures, stopTimedOut: this.stopTimedOut,
      ...(this.lastActivityAt === undefined ? {} : { lastActivityAt: this.lastActivityAt }) });
  }

  async emit(event: WorkerEvent) {
    if (this.deps.onEvent === undefined || this.signal.aborted) return;
    try {
      await withDeadline(async () => this.deps.onEvent?.(event), { operationName: 'worker observer',
        timeoutMs: this.config.observerTimeoutMs, signal: this.signal });
    } catch { this.observerFailures += 1; }
  }
}
