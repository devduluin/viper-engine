import type { EventReplay } from '../../../contracts/events/replay.js';
import type { Clock } from '../../../contracts/identity/ports.js';
import type { StreamTiming } from '../../../application/events/stream.js';

export interface SseOptions extends StreamTiming {
  readonly maxStreamMs: number; readonly maxStreams: number; readonly maxStreamsPerScope: number;
  readonly maxBufferedBytes: number; readonly eventBytes: number;
}
export interface HttpReplay { readonly replay: EventReplay; readonly clock: Clock; readonly options: SseOptions }
