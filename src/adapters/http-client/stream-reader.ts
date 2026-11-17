import { TextDecoder } from 'node:util';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import { withDeadline } from '../../shared/async/deadline.js';
import type { ClientTransport } from './transport.js';
import { SseParser } from './sse-parser.js';
import type { RawSseFrame } from './sse-parser.js';
import { releaseReader } from './body.js';

function text(decoder: TextDecoder, bytes?: Uint8Array): string {
  try { return bytes === undefined ? decoder.decode() : decoder.decode(bytes, { stream: true }); }
  catch { throw new EngineClientFailure('INVALID_RESPONSE'); }
}

export async function* streamFrames(response: Response, transport: ClientTransport, signal: AbortSignal): AsyncGenerator<RawSseFrame> {
  const reader = response.body?.getReader(); if (reader === undefined) throw new EngineClientFailure('INVALID_RESPONSE');
  const cancel = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener('abort', cancel, { once: true });
  const parser = new SseParser(transport.eventBytes + 4096); const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const chunk = await withDeadline(() => reader.read(), { operationName: 'Viper event idle', timeoutMs: transport.config.streamIdleMs, signal });
      if (chunk.done) break;
      for (let offset = 0; offset < chunk.value.byteLength; offset += 65536) {
        yield* parser.feed(text(decoder, chunk.value.subarray(offset, offset + 65536)));
      }
    }
    yield* parser.feed(text(decoder)); yield* parser.finish();
  } finally { signal.removeEventListener('abort', cancel); releaseReader(reader); }
}
