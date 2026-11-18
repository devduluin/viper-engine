import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, request, newConversation, start, field, INPUT } from './http-fixtures.js';

test('conversation list is owner-scoped, newest first, omits empty conversations and pages with a bound cursor', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const first = await newConversation(app); await start(app, first, 'key-a');
    const second = await newConversation(app); await start(app, second, 'key-b');
    await newConversation(app); // never used: no messages, not listed
    await db.pool.query(`UPDATE viper_engine.conversations SET updated_at = updated_at - interval '1 minute' WHERE id = $1`, [first]);

    const page = await request(app, 'GET', '/api/v1/conversations', undefined, { status: 200, schema: 'ConversationPage' });
    const items = page['items'] as { conversationId: string; title?: string; messageCount: number }[];
    assert.deepEqual(items.map(item => item.conversationId), [second, first]);
    assert.equal(items[0]!.title, 'Test');
    assert.ok(items[0]!.messageCount > 0);
    assert.equal(page['nextCursor'], undefined);
    assert.ok(!JSON.stringify(page).includes('Perform this task'), 'summaries carry no message content');

    const one = await request(app, 'GET', '/api/v1/conversations?limit=1', undefined, { status: 200, schema: 'ConversationPage' });
    assert.deepEqual((one['items'] as { conversationId: string }[]).map(item => item.conversationId), [second]);
    const cursor = field(one, 'nextCursor');
    const next = await request(app, 'GET', `/api/v1/conversations?limit=1&cursor=${encodeURIComponent(cursor)}`, undefined, { status: 200 });
    assert.deepEqual((next['items'] as { conversationId: string }[]).map(item => item.conversationId), [first]);
    assert.equal(next['nextCursor'], undefined);

    await request(app, 'GET', `/api/v1/conversations?cursor=${encodeURIComponent(cursor)}`, undefined, { token: 'other', status: 400 });
    await request(app, 'GET', '/api/v1/conversations?cursor=tampered', undefined, { status: 400 });
    assert.deepEqual((await request(app, 'GET', '/api/v1/conversations', undefined, { token: 'other', status: 200 }))['items'], []);
    assert.deepEqual((await request(app, 'GET', '/api/v1/conversations', undefined, { token: 'tenant', status: 200 }))['items'], []);
  } finally { await app.close(); await db.drop(); }
});

test('delete removes a conversation from history and blocks reads and new runs; idempotent; never while a run is active', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const kept = await newConversation(app); await start(app, kept, 'key-k');
    const gone = await newConversation(app); await start(app, gone, 'key-g');
    const busy = await request(app, 'POST', `/api/v1/conversations/${gone}/delete`, {}, { status: 409 });
    assert.equal((busy['error'] as { code: string }).code, 'INVALID_STATE');
    await db.pool.query(`UPDATE viper_engine.runs SET status = 'completed', revision = revision + 1 WHERE conversation_id = $1`, [gone]);

    await request(app, 'POST', `/api/v1/conversations/${gone}/delete`, {}, { token: 'other', status: 404 });
    const deleted = await request(app, 'POST', `/api/v1/conversations/${gone}/delete`, {}, { status: 200, schema: 'ConversationDeleted' });
    assert.equal(deleted['conversationId'], gone);
    assert.deepEqual(await request(app, 'POST', `/api/v1/conversations/${gone}/delete`, {}, { status: 200 }), deleted);

    const page = await request(app, 'GET', '/api/v1/conversations', undefined, { status: 200 });
    assert.deepEqual((page['items'] as { conversationId: string }[]).map(item => item.conversationId), [kept]);
    await request(app, 'GET', `/api/v1/conversations/${gone}`, undefined, { status: 404 });
    await request(app, 'POST', `/api/v1/conversations/${gone}/runs`, INPUT, { key: 'key-after', status: 404 });
    const audit = await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.runs WHERE conversation_id = $1', [gone]);
    assert.equal(audit.rows[0].n, 1, 'runs are kept for audit');
  } finally { await app.close(); await db.drop(); }
});
