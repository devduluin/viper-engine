import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { http, request, newConversation, start, field, errorCode, INPUT } from './http-fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { PostgresConversationStore } from '../../../src/adapters/persistence/postgres/run-store.js';
import { owner } from './fixtures.js';

test('HTTP start commits queue/history/idempotency atomically, retries and parallel requests yield one run', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = await newConversation(app);
    const responses = await Promise.all(Array.from({ length: 6 }, () => start(app, id)));
    const first = responses[0]; assert.ok(first);
    assert.ok(responses.every(response => response['runId'] === first['runId']));
    assert.equal(first['status'], 'queued');
    for (const table of ['runs', 'messages', 'request_idempotency', 'run_instructions']) {
      assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM viper_engine.${table}`)).rows[0].n, 1);
    }
    const snapshot = await request(app, 'GET', `/api/v1/runs/${field(first, 'runId')}`, undefined, { status: 200, schema: 'RunSnapshot' });
    assert.equal(snapshot['lastEventSequence'], 1);
    const changed = await request(app, 'POST', `/api/v1/conversations/${id}/runs`,
      { input: { content: [{ type: 'text', text: 'Changed' }] } }, { key: 'key-1', status: 409 });
    assert.equal(errorCode(changed), 'IDEMPOTENCY_CONFLICT');
    const active = await request(app, 'POST', `/api/v1/conversations/${id}/runs`, INPUT, { key: 'key-2', status: 409 });
    assert.equal(errorCode(active), 'INVALID_STATE');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM viper_engine.request_idempotency')).rows[0].n, 1);
    const history = await request(app, 'GET', `/api/v1/conversations/${id}`, undefined, { status: 200, schema: 'ConversationSnapshot' });
    assert.equal((history['messages'] as readonly unknown[]).length, 1);
  } finally { await app.close(); await db.drop(); }
});

test('foreign actor/tenant IDs reveal no run, conversation or revision data', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = await newConversation(app); const run = await start(app, id);
    for (const token of ['other', 'tenant']) {
      for (const url of [`/api/v1/conversations/${id}`, `/api/v1/runs/${field(run, 'runId')}`]) {
        assert.equal(errorCode(await request(app, 'GET', url, undefined, { token, status: 404 })), 'NOT_FOUND');
      }
      assert.equal(errorCode(await request(app, 'POST', `/api/v1/conversations/${id}/runs`, INPUT,
        { key: 'key-1', token, status: 404 })), 'NOT_FOUND');
      await request(app, 'POST', `/api/v1/runs/${field(run, 'runId')}/cancel`, {}, { token, status: 404 });
    }
    const cancelled = await request(app, 'POST', `/api/v1/runs/${field(run, 'runId')}/cancel`, {}, { status: 202, schema: 'RunSnapshot' });
    const repeated = await request(app, 'POST', `/api/v1/runs/${field(run, 'runId')}/cancel`, {}, { status: 202 });
    assert.equal(repeated['revision'], cancelled['revision']);
    assert.equal(repeated['cancelRequestedAt'], cancelled['cancelRequestedAt']);
  } finally { await app.close(); await db.drop(); }
});

test('transaction rollback removes partial run/idempotency on failed instruction persistence', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = await newConversation(app);
    await db.pool.query('ALTER TABLE viper_engine.run_instructions ADD CONSTRAINT force_failure CHECK (false)');
    const failed = await request(app, 'POST', `/api/v1/conversations/${id}/runs`, INPUT, { key: 'retryable-start', status: 500 });
    assert.equal(errorCode(failed), 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(failed).includes('force_failure'));
    for (const table of ['runs', 'messages', 'run_events', 'request_idempotency']) {
      assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM viper_engine.${table}`)).rows[0].n, 0);
    }
    await db.pool.query('ALTER TABLE viper_engine.run_instructions DROP CONSTRAINT force_failure');
    await start(app, id, 'retryable-start');
  } finally { await app.close(); await db.drop(); }
});

test('encoded opaque IDs and independent resource-scoped idempotency keys are supported', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = parseId('conversation', 'conversation:slash/雪?#');
    await new PostgresConversationStore(db.pool).create(owner, { id, at: Date.now() });
    const a = await start(app, id, 'shared-key'); const b = await start(app, await newConversation(app), 'shared-key');
    assert.notEqual(a['runId'], b['runId']);
    await request(app, 'GET', `/api/v1/conversations/${encodeURIComponent(id)}`, undefined, { status: 200 });
  } finally { await app.close(); await db.drop(); }
});
