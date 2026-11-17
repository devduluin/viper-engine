import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { streamEvents } from '../../../src/application/events/stream.js';
import { eventFrames, writeFrame } from '../../../src/entrypoints/http/sse/frames.js';
import { apiValidation } from '../../../src/entrypoints/http/schema-validation.js';
import { parseFrames } from '../../support/sse/frames.js';
import { testScope } from '../../support/agent/setup.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { ReplayBatch } from '../../../src/contracts/events/replay.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';

const options = { pollMs: 10, heartbeatMs: 30, authRefreshMs: 30, writeTimeoutMs: 10,
  maxStreamMs: 1000, maxStreams: 2, maxStreamsPerScope: 1, maxBufferedBytes: 8192, eventBytes: 4096 };

test('slow stream backpressure stops database polling, times out and removes drain listeners', async () => {
  let release: (() => void) | undefined;
  const response = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { release = callback; } });
  const first: ReplayBatch = { after: 1, highWater: 2, terminal: false, events: [] }; let reads = 0;
  const replay = { open: async () => first, next: async () => { reads += 1; return first; } };
  const controller = new AbortController();
  try {
    await assert.rejects(streamEvents(replay, testScope(), parseId('run', 'r'), first, {
      send: async (_batch, signal) => writeFrame(response, 'bounded frame', signal, 1024),
      heartbeat: async () => undefined, reauthorize: async () => undefined,
    }, { now: () => Date.now() }, options, controller.signal), /event stream delivery/);
    assert.equal(reads, 0); assert.equal(response.listenerCount('drain'), 0);
  } finally { release?.(); response.destroy(); }
});

test('transport checks queued bytes before write and never queues an oversized frame', async () => {
  const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  await assert.rejects(writeFrame(response, 'too large', new AbortController().signal, 1), /buffer limit/);
  assert.equal(response.writableLength, 0); response.destroy();
});

test('SSE serialization resists newline injection, validates schemas and enforces event/batch limits', () => {
  const question = 'Question\n\nid: FORGED\nevent: run.completed';
  const batch: ReplayBatch = { after: 1, highWater: 1, terminal: false, events: [{ cursor: 'SAFE_CURSOR', event: {
    schemaVersion: 1, eventId: 'event-1', runId: 'r', conversationId: 'c', sequence: 1, occurredAt: 1,
    type: 'run.input_required', payload: { question, revision: 1 },
  } }] };
  const validator = apiValidation(); const frames = eventFrames(batch, validator, options);
  assert.equal(frames.length, 1); assert.equal(frames[0]?.match(/^id: /gm)?.length, 1);
  assert.equal(parseFrames(frames.join(''))[0]?.event['type'], 'run.input_required');
  for (const bound of [{ eventBytes: 1 }, { maxBufferedBytes: 1 }]) {
    assert.throws(() => eventFrames(batch, validator, { ...options, ...bound }), error => error instanceof ApiFailure && error.code === 'PAYLOAD_TOO_LARGE');
  }
  assert.throws(() => eventFrames({ ...batch, events: [{ ...batch.events[0]!, cursor: 'bad\nid: FORGED' }] }, validator, options), ApiFailure);
});
