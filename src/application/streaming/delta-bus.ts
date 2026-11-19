/**
 * Process-local fan-out of provisional answer text (`message.delta`). Deltas are a display aid only:
 * never persisted, never replayed, never advance a cursor; `message.completed` stays the source of truth.
 * A client connected to another process than the worker simply gets no deltas (no correctness impact).
 */
import type { EphemeralFrame } from './frames.js';
export type { EphemeralFrame, MessageDeltaFrame } from './frames.js';

type Listener = (frame: EphemeralFrame) => void;

export class DeltaBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Subscribe only after the run's access was authorized (the SSE handler does). */
  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  publish(frame: EphemeralFrame): void {
    for (const listener of this.listeners.get(frame.runId) ?? []) {
      try { listener(frame); } catch { /* a slow or closed stream never affects the run */ }
    }
  }

  get subscriberCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}

/** One bus per process: the worker publishes, the SSE handler of the same host subscribes. */
export const processDeltas = new DeltaBus();
