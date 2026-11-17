import { once } from 'node:events';
import type { ReplayBatch } from '../../../contracts/events/replay.js';
import { ApiFailure } from '../../../contracts/api/failure.js';
import type { apiValidation } from '../schema-validation.js';
import type { SseOptions } from './types.js';

export interface StreamOutput extends NodeJS.EventEmitter {
  readonly writableLength: number; readonly destroyed: boolean;
  write(frame: string): boolean;
}

export function eventFrames(batch: ReplayBatch, validate: ReturnType<typeof apiValidation>, options: SseOptions): readonly string[] {
  let bytes = 0;
  return batch.events.map(item => {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(item.cursor)) throw new ApiFailure('INVALID_CURSOR');
    const event = validate.response('DurableEvent', item.event); const json = JSON.stringify(event);
    if (Buffer.byteLength(json) > options.eventBytes) throw new ApiFailure('PAYLOAD_TOO_LARGE', { runId: event['runId']!, action: 'fetch_snapshot' });
    const frame = `id: ${item.cursor}\nevent: ${String(event['type'])}\ndata: ${json}\n\n`;
    bytes += Buffer.byteLength(frame);
    if (bytes > options.maxBufferedBytes) throw new ApiFailure('PAYLOAD_TOO_LARGE', { action: 'fetch_snapshot', runId: event['runId']! });
    return frame;
  });
}

export async function writeFrame(response: StreamOutput, frame: string, signal: AbortSignal, maximum: number): Promise<void> {
  if (signal.aborted || response.destroyed) throw new Error('Stream closed');
  if (response.writableLength + Buffer.byteLength(frame) > maximum) throw new Error('Stream buffer limit reached');
  if (!response.write(frame)) await once(response, 'drain', { signal });
}
