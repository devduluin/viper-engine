import type { ClientEvent, ClientRead } from '../../contracts/client/ports.js';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import { DURABLE_EVENT_SCHEMAS } from '../../contracts/api/events.js';
import { withDeadline } from '../../shared/async/deadline.js';
import type { RawSseFrame } from './sse-parser.js';
import type { ClientTransport } from './transport.js';
import { transportFailure } from './transport.js';
import { streamFrames } from './stream-reader.js';
import { utf8Bytes } from './body.js';

function decode(transport: ClientTransport, frame: RawSseFrame, runId: string): ClientEvent | undefined {
  if (utf8Bytes(frame.data) > transport.eventBytes) throw new EngineClientFailure('PAYLOAD_TOO_LARGE');
  let data: unknown;
  try { data = JSON.parse(frame.data); } catch { throw new EngineClientFailure('INVALID_RESPONSE'); }
  if (frame.type === 'message.delta') {
    const delta = transport.codec.response('MessageDelta', data);
    if (frame.id !== undefined || delta['runId'] !== runId) throw new EngineClientFailure('INVALID_RESPONSE');
    return undefined; // Ephemeral text cannot acknowledge replay.
  }
  if (frame.type === undefined || !Object.hasOwn(DURABLE_EVENT_SCHEMAS, frame.type)) throw new EngineClientFailure('UNSUPPORTED_EVENT');
  const event = transport.codec.response('DurableEvent', data);
  if (event.type !== frame.type || event.runId !== runId) throw new EngineClientFailure('INVALID_RESPONSE');
  return { event, cursor: frameCursor(frame) };
}

function frameCursor(frame: RawSseFrame): string {
  if (frame.id === undefined || !/^[A-Za-z0-9_-]{1,2048}$/.test(frame.id)) throw new EngineClientFailure('INVALID_RESPONSE');
  return frame.id;
}

async function open(transport: ClientTransport, path: string, cursor: string | undefined, lifetime: AbortSignal) {
  return withDeadline(async signal => {
    const response = await transport.config.fetch(`${transport.config.origin}${path}`, { method: 'GET', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.any([signal, lifetime]), headers: { ...await transport.headers(), accept: 'text/event-stream',
        ...(cursor === undefined ? {} : { 'last-event-id': cursor }) } });
    if (!response.ok) return transport.error(response, signal);
    if (response.status !== 200 || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel(); throw new EngineClientFailure('INVALID_RESPONSE');
    }
    return response;
  }, { operationName: 'Viper event headers', timeoutMs: transport.config.requestTimeoutMs, signal: lifetime });
}

export async function* clientEvents(transport: ClientTransport, runId: string, path: string,
  options: ClientRead & { readonly cursor?: string }): AsyncGenerator<ClientEvent> {
  const lifetime = new AbortController(); const cleanup = followAbort(options.signal, lifetime);
  try {
    if (options.cursor !== undefined && !/^[A-Za-z0-9_-]{1,2048}$/.test(options.cursor)) throw new EngineClientFailure('INVALID_CURSOR');
    const response = await open(transport, path, options.cursor, lifetime.signal);
    for await (const frame of streamFrames(response, transport, lifetime.signal)) {
      const event = decode(transport, frame, runId); if (event !== undefined) yield event;
    }
    if (options.signal?.aborted) throw new EngineClientFailure('CANCELLED');
  } catch (error) { throw transportFailure(error, options.signal); }
  finally {
    lifetime.abort(); cleanup();
  }
}

function followAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
  return () => signal?.removeEventListener('abort', stop);
}
