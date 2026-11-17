import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, request, newConversation, start, field, errorCode, INPUT } from './http-fixtures.js';
import { owner } from './fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { PostgresConversationStore } from '../../../src/adapters/persistence/postgres/run-store.js';
import { persistedRunInstructions } from '../../../src/bootstrap/http.js';
import { engine, anthropic, done, checkpoint } from './engine-fixtures.js';
import { startHttpServer } from '../../support/mcp/harness.js';
import { seedEngineConnection } from './engine-fixtures.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';

test('history pagination cursors are scoped, signed, distinct from events and survive API restart', async () => {
  const db = await createDatabase(); const app = http(db.pool); const restarted = http(db.pool);
  try {
    const id = await newConversation(app); const conversationId = parseId('conversation', id);
    const messages = new PostgresMessageStore(db.pool);
    assert.ok((await messages.append(owner, conversationId, { expectedRevision: 1, at: Date.now(),
      messages: [1, 2, 3].map(n => parseMessage({ id: `page-${n}`, role: 'user', content: [{ type: 'text', text: `Text ${n}` }] })) })).ok);
    const page = await request(app, 'GET', `/api/v1/conversations/${id}?limit=1`, undefined, { status: 200, schema: 'ConversationSnapshot' });
    const token = field(page, 'nextCursor');
    const next = await request(restarted, 'GET', `/api/v1/conversations/${id}?limit=1&cursor=${token}`, undefined, { status: 200 });
    assert.match(JSON.stringify(next['messages']), /Text 2/);
    const different = await newConversation(app);
    assert.equal(errorCode(await request(app, 'GET', `/api/v1/conversations/${different}?cursor=${token}`, undefined, { status: 400 })), 'INVALID_CURSOR');
    const started = await start(app, different);
    const snap = await request(app, 'GET', `/api/v1/runs/${field(started, 'runId')}`, undefined, { status: 200 });
    await request(app, 'GET', `/api/v1/conversations/${id}?cursor=${field(snap, 'eventCursor')}`, undefined, { status: 400 });
    await request(app, 'GET', `/api/v1/mcp/connections?cursor=${token}`, undefined, { status: 400 });
    await request(app, 'GET', `/api/v1/conversations/${id}?cursor=${token.slice(0, -5)}xxxxx`, undefined, { status: 400 });
    await request(app, 'GET', `/api/v1/conversations/${id}?cursor=${token}`, undefined, { token: 'other', status: 404 });
  } finally { await app.close(); await restarted.close(); await db.drop(); }
});

test('configured context preparation is stored privately, consumed by actual engine, and not repeated on start replay', async () => {
  const db = await createDatabase(); const server = await startHttpServer(); let prepared = 0;
  const connectionId = await seedEngineConnection(db.pool, server.url, 'http-context');
  const app = http(db.pool, { prepareContext: async (scope, context) => {
    assert.equal(scope.actorId, owner.actorId); assert.ok(context['resources']); prepared += 1;
    return [parseMessage({ id: 'private-context', role: 'system', content: [{ type: 'text', text: 'PRIVATE_PREPARED_CONTEXT' }] })];
  } });
  const { api, model } = anthropic([done]);
  const worker = engine(db.pool, connectionId, model, { instructions: persistedRunInstructions(db.pool) });
  try {
    const id = await newConversation(app); const url = `/api/v1/conversations/${id}/runs`;
    const body = { ...INPUT, context: { resources: [{ connectionId, uri: 'fixture://policy' }] } };
    const started = await request(app, 'POST', url, body, { key: 'context', status: 202 });
    await request(app, 'POST', url, body, { key: 'context', status: 202 }); assert.equal(prepared, 1);
    const result = await worker.runOnce('http-context-worker');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    assert.match(JSON.stringify(api.bodies[0]?.['system']), /PRIVATE_PREPARED_CONTEXT/);
    const history = await request(app, 'GET', `/api/v1/conversations/${id}`, undefined, { status: 200 });
    assert.ok(!JSON.stringify(history).includes('PRIVATE_PREPARED_CONTEXT'));
    const cp = await checkpoint(db.pool, parseId('run', started['runId'])); assert.equal(cp.history.length, 2);
  } finally { await worker.close(); await app.close(); await server.stop(); await db.drop(); }
});

test('unconfigured/denied context fails before run creation and does not leave idempotency claims', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  const denied = http(db.pool, { prepareContext: async () => { throw new ApiFailure('ACCESS_DENIED'); } });
  try {
    const id = await newConversation(app);
    const connectionId = await seedEngineConnection(db.pool, 'http://127.0.0.1/unused', 'denied-context');
    const body = { ...INPUT, context: { prompts: [{ connectionId, name: 'unsafe' }] } };
    await request(app, 'POST', `/api/v1/conversations/${id}/runs`, body, { key: 'context', status: 400 });
    await request(denied, 'POST', `/api/v1/conversations/${id}/runs`, body, { key: 'context', status: 403 });
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.runs')).rows[0].n, 0);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.request_idempotency')).rows[0].n, 0);
  } finally { await app.close(); await denied.close(); await db.drop(); }
});

test('full-length Unicode resource IDs fit the route and contract', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = parseId('conversation', '雪'.repeat(256));
    await new PostgresConversationStore(db.pool).create(owner, { id, at: Date.now() });
    await request(app, 'GET', `/api/v1/conversations/${encodeURIComponent(id)}`, undefined, { status: 200, schema: 'ConversationSnapshot' });
  } finally { await app.close(); await db.drop(); }
});

test('context selections always check owned connection and auth before invoking host preparation', async () => {
  const db = await createDatabase(); let prepared = 0;
  const app = http(db.pool, { prepareContext: async () => { prepared += 1; return []; } });
  try {
    const id = await newConversation(app); const url = `/api/v1/conversations/${id}/runs`;
    const selection = (connectionId: string) => ({ ...INPUT, context: { resources: [{ connectionId, uri: 'fixture://policy' }] } });
    await request(app, 'POST', url, selection('foreign'), { key: 'same', status: 404 });
    const connection = await seedEngineConnection(db.pool, 'http://127.0.0.1/unused', 'context-auth');
    await db.pool.query("UPDATE viper_engine.mcp_connections SET auth_state = 'authentication_required', revision = revision + 1 WHERE id = $1", [connection]);
    await request(app, 'POST', url, selection(connection), { key: 'same', status: 401 });
    assert.equal(prepared, 0);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.runs')).rows[0].n, 0);
  } finally { await app.close(); await db.drop(); }
});
