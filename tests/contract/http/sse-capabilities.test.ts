import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngineHttpServer } from '../../../src/bootstrap/http.js';
import { testScope } from '../../support/agent/setup.js';
import { assertValid } from '../api/validate.js';

test('configured HTTP exposes all 12 operations; explicit stream disable preserves capabilities truth', async () => {
  const unexpected = () => { throw new Error('Database not needed for capabilities'); };
  for (const enabled of [true, false]) {
    const app = createEngineHttpServer({ query: unexpected, connect: unexpected }, { cursorSecret: Buffer.alloc(32),
      authorizeServer: async () => false, authenticate: async () => testScope(), ...(enabled ? {} : { stream: false }) });
    try {
      const result = await app.inject({ method: 'GET', url: '/api/v1/capabilities', headers: { authorization: 'Bearer owner' } });
      assert.equal(result.statusCode, 200); assertValid('Capabilities', result.json());
      assert.equal(result.json().features.eventReplay, enabled);
      assert.equal(app.hasRoute({ method: 'GET', url: '/api/v1/runs/:runId/events' }), enabled);
    } finally { await app.close(); }
  }
});

test('invalid stream timers, capacity and framing buffer fail during construction', () => {
  const unexpected = () => { throw new Error('No I/O expected'); };
  for (const stream of [{ pollMs: 0 }, { maxStreams: 0 }, { maxStreamsPerScope: 0 }, { batchSize: 65 }, { maxBufferedBytes: 1 }]) {
    assert.throws(() => createEngineHttpServer({ query: unexpected, connect: unexpected }, { cursorSecret: Buffer.alloc(32),
      authorizeServer: async () => false, authenticate: async () => undefined, stream }));
  }
});
