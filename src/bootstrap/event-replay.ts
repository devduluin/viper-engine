import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { PostgresEventReplay } from '../adapters/persistence/postgres/event-replay.js';
import { ReplayEvents } from '../application/events/replay.js';
import type { ApiCursorPort } from '../contracts/api/control.js';
import type { Clock } from '../contracts/identity/ports.js';
import type { SseOptions } from '../entrypoints/http/sse/types.js';
import { assertTimerDuration } from '../shared/async/delay.js';

export type EventStreamOptions = Partial<Omit<SseOptions, 'eventBytes'>> & { readonly batchSize?: number };
function positive(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid event stream bound');
  return value;
}
function timing(options: EventStreamOptions) {
  const settings = { pollMs: options.pollMs ?? 1000, heartbeatMs: options.heartbeatMs ?? 15000,
    authRefreshMs: options.authRefreshMs ?? 15000, writeTimeoutMs: options.writeTimeoutMs ?? 10000,
    maxStreamMs: options.maxStreamMs ?? 300000 };
  for (const value of Object.values(settings)) { assertTimerDuration('event stream timer', value); positive(value, 2147483647); }
  return settings;
}

export function eventReplay(pool: SqlPool, cursors: ApiCursorPort, clock: Clock, eventBytes: number,
  retentionSeconds: number, configured: EventStreamOptions = {}) {
  const maxBufferedBytes = positive(configured.maxBufferedBytes ?? Math.max(1048576, eventBytes + 4096), 16777216);
  if (maxBufferedBytes < eventBytes + 4096) throw new RangeError('Stream buffer must fit an event plus cursor framing');
  const batchSize = Math.min(positive(configured.batchSize ?? 16, 64), Math.max(1, Math.floor(maxBufferedBytes / (eventBytes + 4096))));
  const options: SseOptions = Object.freeze({ ...timing(configured), eventBytes, maxBufferedBytes,
    maxStreams: positive(configured.maxStreams ?? 64, 4096), maxStreamsPerScope: positive(configured.maxStreamsPerScope ?? 8, 256) });
  return { replay: new ReplayEvents(new PostgresEventReplay(pool, retentionSeconds), cursors, batchSize), clock, options };
}
