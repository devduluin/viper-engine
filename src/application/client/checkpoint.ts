import { EngineClientFailure } from '../../contracts/client/failure.js';
import type { ClientCheckpoint, ClientEvent, ClientUpdate } from '../../contracts/client/ports.js';
import type { RunSnapshotView } from '../../contracts/client/views.js';

export function snapshotCheckpoint(snapshot: RunSnapshotView): ClientCheckpoint {
  return { runId: snapshot.runId, cursor: snapshot.eventCursor, sequence: snapshot.lastEventSequence };
}
export function validateCheckpoint(checkpoint: ClientCheckpoint, runId: string, highwater: number): void {
  if (checkpoint.runId !== runId || !/^[A-Za-z0-9_-]{1,2048}$/.test(checkpoint.cursor)
    || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 || checkpoint.sequence > highwater) {
    throw new EngineClientFailure('INVALID_CURSOR');
  }
}
export class WatchCheckpoint {
  private readonly recent = new Map<number, string>();
  constructor(public value: ClientCheckpoint) {}
  update(item: ClientEvent): Extract<ClientUpdate, { kind: 'event' }> | undefined {
    const event = item.event;
    if (event.runId !== this.value.runId) throw new EngineClientFailure('INVALID_RESPONSE');
    const seen = this.recent.get(event.sequence);
    if (seen !== undefined && seen !== event.eventId) throw new EngineClientFailure('STREAM_GAP');
    if (event.sequence <= this.value.sequence) return undefined;
    if (event.sequence !== this.value.sequence + 1) throw new EngineClientFailure('STREAM_GAP');
    return { kind: 'event', event, checkpoint: { runId: event.runId, cursor: item.cursor, sequence: event.sequence } };
  }
  accept(update: Extract<ClientUpdate, { kind: 'event' }>): void {
    this.value = update.checkpoint; this.recent.set(update.event.sequence, update.event.eventId);
    if (this.recent.size > 512) { const first = this.recent.keys().next(); if (!first.done) this.recent.delete(first.value); }
  }
}
