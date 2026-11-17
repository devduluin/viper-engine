import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from './database.js';
import { http, request, newConversation, field, INPUT } from './http-fixtures.js';
import { driver } from './durable-fixtures.js';
import { finalText } from '../../unit/runtime/harness.js';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { seedConnection, owner } from './fixtures.js';

test('client disconnect does not cancel an accepted command; worker runs after HTTP server closes', async () => {
  const db = await createDatabase();
  const connection = await seedConnection(db.pool, owner, 'lifetime-connection');
  let release: (() => void) | undefined; const barrier = new Promise<void>(resolve => { release = resolve; });
  let enter: (() => void) | undefined; const entered = new Promise<void>(resolve => { enter = resolve; });
  const app = http(db.pool, { prepareContext: async () => { enter?.(); await barrier; return []; } });
  try {
    const id = await newConversation(app); const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const payload = JSON.stringify({ ...INPUT, context: { resources: [{ connectionId: connection.connectionId, uri: 'fixture://context' }] } });
    const client = httpRequest(`${origin}/api/v1/conversations/${id}/runs`, { method: 'POST', headers: {
      authorization: 'Bearer owner', 'idempotency-key': 'disconnect', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } });
    client.on('error', () => undefined); client.end(payload);
    await withDeadline(() => entered, { operationName: 'command preparation', timeoutMs: 10000 });
    client.destroy(); release?.();
    const runId = await withDeadline(async signal => {
      while (!signal.aborted) {
        const rows = await db.pool.query('SELECT id FROM viper_engine.runs WHERE conversation_id = $1', [id]);
        if (rows.rows[0] !== undefined) return String(rows.rows[0].id);
        await delay(20);
      }
      throw signal.reason;
    }, { operationName: 'command commit', timeoutMs: 10000 });
    await app.close();
    const worker = await driver(db.pool, [finalText('Completed after disconnect')]);
    const result = await worker.driver.runOnce('disconnected-client');
    assert.ok(result.kind === 'settled' && result.status === 'completed', JSON.stringify(result));
    const row = await db.pool.query('SELECT cancel_requested_at FROM viper_engine.runs WHERE id = $1', [runId]);
    assert.equal(row.rows[0].cancel_requested_at, null);
  } finally { release?.(); await app.close(); await db.drop(); }
});

test('HTTP server shutdown leaves queued runs and database pool available', async () => {
  const db = await createDatabase(); const app = http(db.pool);
  try {
    const id = await newConversation(app);
    const accepted = await request(app, 'POST', `/api/v1/conversations/${id}/runs`, INPUT, { key: 'lifetime', status: 202 });
    await app.close();
    const run = await db.pool.query('SELECT status, cancel_requested_at FROM viper_engine.runs WHERE id = $1', [field(accepted, 'runId')]);
    assert.equal(run.rows[0].status, 'queued'); assert.equal(run.rows[0].cancel_requested_at, null);
  } finally { await app.close(); await db.drop(); }
});
