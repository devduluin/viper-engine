import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { streamEvents } from '../../../application/events/stream.js';
import { processDeltas } from '../../../application/streaming/delta-bus.js';
import { streamRequest } from './request.js';
import { eventFrames, writeFrame } from './frames.js';
import type { HttpReplay } from './types.js';
import type { StreamSessions } from './sessions.js';
import type { apiValidation } from '../schema-validation.js';

export async function handleEventStream(request: FastifyRequest, reply: FastifyReply, scope: TrustedScope,
  config: HttpReplay, sessions: StreamSessions, validator: ReturnType<typeof apiValidation>, reauthorize: () => Promise<void>) {
  const input = streamRequest(request); const controller = new AbortController();
  const release = sessions.acquire(scope, controller, () => reply.raw.destroy());
  const disconnected = () => controller.abort(); reply.raw.on('close', disconnected);
  let unsubscribe = () => {};
  try {
    const first = await config.replay.open(scope, input.runId, input.cursor);
    if (controller.signal.aborted) return;
    eventFrames(first, validator, config.options); // Validate before committing HTTP 200.
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined && value !== null) reply.raw.setHeader(name, value);
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    const write = (frame: string, signal: AbortSignal) => writeFrame(reply.raw, frame, signal, config.options.maxBufferedBytes);
    // Provisional text (message.delta): no id line, so it never moves Last-Event-ID; dropped when the socket is busy.
    unsubscribe = processDeltas.subscribe(input.runId, (frame) => {
      if (controller.signal.aborted || reply.raw.destroyed || reply.raw.writableLength > config.options.maxBufferedBytes / 2) return;
      reply.raw.write(`event: message.delta\ndata: ${JSON.stringify(validator.response('MessageDelta', frame))}\n\n`);
    });
    await streamEvents(config.replay, scope, input.runId, first, {
      reauthorize, connected: signal => write(': connected\n\n', signal), heartbeat: signal => write(': heartbeat\n\n', signal),
      send: async (batch, signal) => { for (const frame of eventFrames(batch, validator, config.options)) await write(frame, signal); },
    }, config.clock, config.options, controller.signal);
    if (!reply.raw.destroyed) reply.raw.end();
  } catch (error) {
    if (!reply.raw.headersSent && !controller.signal.aborted) throw error;
    reply.raw.destroy(); // Mid-stream faults never emit invalid JSON or advance a cursor.
  } finally { unsubscribe(); controller.abort(); release(); reply.raw.removeListener('close', disconnected); }
}
