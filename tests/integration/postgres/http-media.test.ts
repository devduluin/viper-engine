import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, request, newConversation, errorCode } from './http-fixtures.js';
import { owner } from './fixtures.js';

test('reference media requires explicit scoped host grant; denial creates no run or dedup claim', async () => {
  const db = await createDatabase(); const app = http(db.pool); let checks = 0;
  const granted = http(db.pool, { authorizeMedia: async (scope, source) => {
    assert.equal(scope.actorId, owner.actorId); checks += 1;
    return source.uri === 'https://owned.example/image.png';
  } });
  const body = (uri: string) => ({ input: { content: [{ type: 'image', source: { kind: 'reference', mediaType: 'image/png', uri } }] } });
  try {
    const id = await newConversation(app); const url = `/api/v1/conversations/${id}/runs`;
    const denied = await request(app, 'POST', url, body('file:///private'), { key: 'media', status: 403 });
    assert.equal(errorCode(denied), 'ACCESS_DENIED');
    await request(granted, 'POST', url, body('https://foreign.example/image.png'), { key: 'media', status: 403 });
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.request_idempotency')).rows[0].n, 0);
    await request(granted, 'POST', url, body('https://owned.example/image.png'), { key: 'media', status: 202 });
    await request(granted, 'POST', url, body('https://owned.example/image.png'), { key: 'media', status: 202 });
    assert.equal(checks, 2); // One denial and one new acceptance; replay does not repeat authorization/fetch.
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.messages')).rows[0].n, 1);
  } finally { await app.close(); await granted.close(); await db.drop(); }
});
