import type { EventReplay, ReplayBatch } from '../../contracts/events/replay.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunId } from '../../contracts/identity/ids.js';
import type { Clock } from '../../contracts/identity/ports.js';
import { delay } from '../../shared/async/delay.js';
import { withDeadline } from '../../shared/async/deadline.js';

export interface StreamTiming {
  readonly pollMs: number; readonly heartbeatMs: number; readonly authRefreshMs: number; readonly writeTimeoutMs: number;
}
export interface EventStreamSink {
  connected?(signal: AbortSignal): Promise<void>;
  send(batch: ReplayBatch, signal: AbortSignal): Promise<void>;
  heartbeat(signal: AbortSignal): Promise<void>;
  reauthorize(): Promise<void>;
}

/** Read-only pump. Its connection signal never reaches a worker, model or tool gateway. */
export async function streamEvents(replay: EventReplay, scope: TrustedScope, runId: RunId, first: ReplayBatch,
  sink: EventStreamSink, clock: Clock, timing: StreamTiming, signal: AbortSignal): Promise<void> {
  let batch = first; let lastBeat = clock.now(); let lastAuth = clock.now();
  const bounded = <T>(operation: (signal: AbortSignal) => Promise<T>) => withDeadline(operation,
    { operationName: 'event stream delivery', timeoutMs: timing.writeTimeoutMs, signal });
  const connected = sink.connected;
  if (connected !== undefined) await bounded(connected);
  while (!signal.aborted) {
    if (clock.now() - lastAuth >= timing.authRefreshMs) { await bounded(() => sink.reauthorize()); lastAuth = clock.now(); }
    await bounded(child => sink.send(batch, child));
    if (batch.terminal && batch.after >= batch.highWater) return;
    if (clock.now() - lastBeat >= timing.heartbeatMs) { await bounded(child => sink.heartbeat(child)); lastBeat = clock.now(); }
    if (batch.after >= batch.highWater) await delay(Math.min(timing.pollMs, timing.heartbeatMs, timing.authRefreshMs), { signal });
    batch = await replay.next(scope, runId, batch.after);
  }
}
