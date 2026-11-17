import { parseWorkerId } from '../../contracts/state/leases.js';
import { assertTimerDuration } from '../../shared/async/delay.js';
import type { WorkerOptions } from './types.js';

function timer(value: number): number {
  assertTimerDuration('worker duration', value);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Worker duration must be a positive integer');
  return value;
}
function count(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid worker count');
  return value;
}

function intervals(options: WorkerOptions) {
  return { pollMs: timer(options.pollMs ?? 500), maintenanceMs: timer(options.maintenanceMs ?? 5000),
    shutdownTimeoutMs: timer(options.shutdownTimeoutMs ?? 15000), observerTimeoutMs: timer(options.observerTimeoutMs ?? 1000) };
}

export function workerSettings(options: WorkerOptions) {
  const workerId = parseWorkerId(options.workerId);
  if (workerId.length > 100) throw new RangeError('Worker prefix exceeds 100 characters');
  const errorBackoffMs = timer(options.errorBackoffMs ?? 500);
  const maxErrorBackoffMs = timer(options.maxErrorBackoffMs ?? 30000);
  if (maxErrorBackoffMs < errorBackoffMs) throw new RangeError('Invalid worker backoff range');
  return Object.freeze({ workerId, errorBackoffMs, maxErrorBackoffMs,
    ...intervals(options), concurrency: count(options.concurrency ?? 4, 32),
    maintenanceBatch: count(options.maintenanceBatch ?? 100, 1000) });
}
export type WorkerSettings = ReturnType<typeof workerSettings>;
