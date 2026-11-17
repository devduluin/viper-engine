import type { WorkerState } from './state.js';
import { delay } from '../../shared/async/delay.js';

function backoff(state: WorkerState, failures: number): number {
  return Math.min(state.config.maxErrorBackoffMs, state.config.errorBackoffMs * (2 ** Math.min(failures - 1, 30)));
}
async function pause(state: WorkerState, ms: number): Promise<void> {
  try { await delay(ms, { signal: state.signal }); } catch (error) { if (!state.signal.aborted) throw error; }
}

export async function deliveryLoop(state: WorkerState, slot: number) {
  let failures = 0;
  while (!state.signal.aborted) {
    let waitMs = state.config.pollMs;
    state.active += 1; state.maxActive = Math.max(state.maxActive, state.active);
    try {
      const result = await state.deps.engine.runOnce(`${state.config.workerId}:${slot}`, state.signal);
      failures = 0; state.lastActivityAt = state.deps.clock.now();
      if (result.kind === 'idle') state.idlePolls += 1;
      else {
        if (result.kind === 'settled') { state.settled += 1; waitMs = 0; } else state.yielded += 1;
        await state.emit({ type: 'delivery', slot, result });
      }
    } catch (error) {
      if (!state.signal.aborted) {
        failures += 1; state.failures += 1; waitMs = backoff(state, failures);
        await state.emit({ type: 'failure', slot, code: state.deps.classify(error) });
      }
    } finally { state.active -= 1; }
    if (!state.signal.aborted) await pause(state, waitMs);
  }
}

export async function maintenanceLoop(state: WorkerState) {
  let failures = 0;
  while (!state.signal.aborted) {
    let waitMs = state.config.maintenanceMs;
    try {
      const woken = await state.deps.maintain(state.config.maintenanceBatch);
      failures = 0; state.maintenanceWoken += woken;
      if (woken > 0) await state.emit({ type: 'maintenance', woken });
    } catch (error) {
      if (!state.signal.aborted) {
        failures += 1; state.maintenanceFailures += 1; waitMs = Math.max(waitMs, backoff(state, failures));
        await state.emit({ type: 'failure', code: state.deps.classify(error) });
      }
    }
    if (!state.signal.aborted) await pause(state, waitMs);
  }
}
