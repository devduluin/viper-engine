import assert from 'node:assert/strict';
import { test } from 'node:test';
import { client, json, snapshot, frame, sse, failure } from '../../support/client/fixtures.js';
import type { ClientUpdate } from '../../../src/contracts/client/ports.js';

const fast = { reconnectMs: 1, maxReconnectMs: 2, maxReconnects: 3 };
async function updates(api: ReturnType<typeof client>, options = {}) {
  const found: ClientUpdate[] = []; for await (const update of api.watch('run-1', { ...fast, ...options })) found.push(update); return found;
}

test('watch reconnects reads with Last-Event-ID, ignores duplicates and fetches final usage', async () => {
  let streams = 0; let reads = 0; const cursors: (string | null)[] = [];
  const api = client(async (url, init) => {
    assert.equal(init?.method, 'GET');
    if (String(url).endsWith('/events')) {
      cursors.push(new Headers(init?.headers).get('last-event-id')); streams++;
      return sse(streams === 1 ? frame() : `${frame()}${frame(2, 'run.completed')}`);
    }
    reads++; return json(reads === 1 ? snapshot() : snapshot({ status: 'completed', lastEventSequence: 2, eventCursor: 'cursor_2',
      usage: { modelCalls: 1, source: 'provider', inputTokens: 10, outputTokens: 5, totalTokens: 15 } }));
  });
  const found = await updates(api);
  assert.deepEqual(found.filter(item => item.kind === 'event').map(item => item.event.sequence), [1, 2]);
  assert.deepEqual(cursors, ['cursor_0', 'cursor_1']); assert.equal(reads, 2);
  assert.deepEqual(found.at(-1), { kind: 'snapshot', recovered: false, snapshot: snapshot({ status: 'completed', lastEventSequence: 2,
    eventCursor: 'cursor_2', usage: { modelCalls: 1, source: 'provider', inputTokens: 10, outputTokens: 5, totalTokens: 15 } }) });
});

test('watch resynchronizes on cursor expiry without starting a run or replaying writes', async () => {
  let reads = 0; let streams = 0;
  const api = client(async url => {
    if (String(url).endsWith('/events')) { streams++; return json({ error: { code: 'EVENT_CURSOR_EXPIRED', message: 'expired', requestId: 'req',
      retryable: false, recovery: { action: 'fetch_snapshot', runId: 'run-1' } } }, 410); }
    reads++; return json(reads === 1 ? snapshot() : snapshot({ status: 'partial', lastEventSequence: 5, eventCursor: 'cursor_5' }));
  });
  const found = await updates(api); assert.equal(streams, 1); assert.equal(reads, 2);
  assert.deepEqual(found.map(item => item.kind === 'snapshot' ? item.recovered : null), [false, true]);
  assert.ok(found.at(-1)?.kind === 'snapshot');
});

test('watch detects sequence gaps and resumes after snapshot highwater', async () => {
  let reads = 0; let streams = 0;
  const api = client(async (url, init) => {
    if (String(url).endsWith('/events')) {
      streams++; if (streams === 1) return sse(frame(3));
      assert.equal(new Headers(init?.headers).get('last-event-id'), 'cursor_3'); return sse(frame(4, 'run.completed'));
    }
    reads++; return json(reads === 1 ? snapshot() : snapshot({ status: reads === 2 ? 'running' : 'completed',
      lastEventSequence: reads === 2 ? 3 : 4, eventCursor: `cursor_${reads === 2 ? 3 : 4}` }));
  });
  const found = await updates(api); assert.deepEqual(found.filter(item => item.kind === 'event').map(item => item.event.sequence), [4]);
  assert.equal(found.filter(item => item.kind === 'snapshot' && item.recovered).length, 1);
});

test('watch bounded reconnects stop; authentication failure does not retry', async () => {
  let streams = 0;
  const api = client(async url => {
    if (String(url).endsWith('/events')) { streams++; return sse(''); } return json(snapshot());
  });
  await assert.rejects(updates(api, { maxReconnects: 2 }), failure('RECONNECT_LIMIT')); assert.equal(streams, 3);
  streams = 0;
  const denied = client(async url => {
    if (!String(url).endsWith('/events')) return json(snapshot()); streams++;
    return json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'authenticate', requestId: 'req', retryable: false } }, 401);
  });
  await assert.rejects(updates(denied), failure('AUTHENTICATION_REQUIRED')); assert.equal(streams, 1);
});

test('terminal snapshot needs no stream; a saved older checkpoint still replays through terminal', async () => {
  let streams = 0;
  const api = client(async url => {
    if (!String(url).endsWith('/events')) return json(snapshot({ status: 'completed', eventCursor: 'cursor_2', lastEventSequence: 2 }));
    streams++; return sse(`${frame()}${frame(2, 'run.completed')}`);
  });
  assert.equal((await updates(api)).length, 1); assert.equal(streams, 0);
  const found = await updates(api, { checkpoint: { runId: 'run-1', cursor: 'cursor_0', sequence: 0 } });
  assert.deepEqual(found.filter(item => item.kind === 'event').map(item => item.event.sequence), [1, 2]); assert.equal(streams, 1);
  await assert.rejects(updates(api, { checkpoint: { runId: 'run-other', cursor: 'cursor_0', sequence: 0 } }), failure('INVALID_CURSOR'));
});

test('breaking watch closes stream and exposes only the applied event checkpoint', async () => {
  let reads = 0; let streams = 0;
  const api = client(async url => {
    if (!String(url).endsWith('/events')) { reads++; return json(snapshot()); }
    streams++; return sse(`${frame()}${frame(2)}`);
  });
  for await (const update of api.watch('run-1', fast)) {
    if (update.kind === 'event') { assert.deepEqual(update.checkpoint, { runId: 'run-1', cursor: 'cursor_1', sequence: 1 }); break; }
  }
  assert.equal(reads, 1); assert.equal(streams, 1);
});

test('final snapshot read can retry without reopening terminal stream', async () => {
  let reads = 0; let streams = 0;
  const api = client(async url => {
    if (String(url).endsWith('/events')) { streams++; return sse(frame(1, 'run.completed')); }
    reads++; if (reads === 2) throw new Error('temporary network failure');
    return json(reads === 1 ? snapshot() : snapshot({ status: 'completed', lastEventSequence: 1, eventCursor: 'cursor_1' }));
  });
  await updates(api); assert.equal(reads, 3); assert.equal(streams, 1);
});
