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

test('start run stores the chosen effort; an unknown effort is rejected by the schema', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const conversation = await newConversation(app);
    const accepted = await request(app, 'POST', `/api/v1/conversations/${conversation}/runs`,
      { ...INPUT, options: { effort: 'high' } }, { key: 'key-effort', status: 202, schema: 'RunAccepted' });
    const stored = await db.pool.query('SELECT effort FROM viper_engine.runs WHERE id = $1', [accepted['runId']]);
    assert.equal(stored.rows[0].effort, 'high');
    const other = await newConversation(app);
    await request(app, 'POST', `/api/v1/conversations/${other}/runs`, { ...INPUT, options: { effort: 'max' } }, { key: 'key-bad', status: 400 });
    const plain = await start(app, other, 'key-plain');
    assert.equal((await db.pool.query('SELECT effort FROM viper_engine.runs WHERE id = $1', [plain['runId']])).rows[0].effort, null);
  } finally { await app.close(); await db.drop(); }
});

test('title: user rename, generated title from the first exchange, owner-scoped; no generator = 400', async () => {
  const db = await createDatabase();
  const seen: { question: string; answer: string }[] = [];
  const app = http(db.pool, { titleConversation: async (_scope, exchange) => { seen.push(exchange); return '  "Rekap absensi November."  '; } });
  const plain = http(db.pool);
  try {
    const conversation = await newConversation(app); await start(app, conversation, 'key-t');
    const generated = await request(app, 'POST', `/api/v1/conversations/${conversation}/title`, {}, { status: 200, schema: 'ConversationTitle' });
    assert.equal(generated['title'], 'Rekap absensi November');
    assert.equal(seen[0]?.question, 'Perform this task');
    const renamed = await request(app, 'POST', `/api/v1/conversations/${conversation}/title`, { title: '  Absensi tim CS  ' }, { status: 200 });
    assert.equal(renamed['title'], 'Absensi tim CS');
    const listed = await request(app, 'GET', '/api/v1/conversations', undefined, { status: 200 });
    assert.equal((listed['items'] as { title: string }[])[0]?.title, 'Absensi tim CS');
    await request(app, 'POST', `/api/v1/conversations/${conversation}/title`, { title: 'x' }, { token: 'other', status: 404 });
    await request(plain, 'POST', `/api/v1/conversations/${conversation}/title`, {}, { status: 400 });
  } finally { await app.close(); await plain.close(); await db.drop(); }
});
