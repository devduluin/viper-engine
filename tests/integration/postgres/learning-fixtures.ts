import assert from 'node:assert/strict';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { anthropic, done, engine, toolTurn } from './engine-fixtures.js';
import type { FakeReply } from '../../support/anthropic/fake-api.js';
import { createEngineLearning } from '../../../src/bootstrap/learning.js';
import { createEngineRecall } from '../../../src/bootstrap/recall.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { PostgresConversationStore } from '../../../src/adapters/persistence/postgres/run-store.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { userMessage } from './recall-fixtures.js';
import { owner } from './fixtures.js';
import type { ViperEngineOptions } from '../../../src/bootstrap/engine-types.js';

export const candidate = 'Untuk laporan stok, gunakan hasil MCP terbaru dan sertakan waktu pemeriksaan.';
export async function appendStatement(pool: SqlPool, conversationId: string, id: string, text = candidate) {
  const cid = parseId('conversation', conversationId);
  const before = await new PostgresConversationStore(pool).get(owner, cid); assert.ok(before.ok);
  const appended = await new PostgresMessageStore(pool).append(owner, cid,
    { expectedRevision: before.value.revision, at: Date.now(), messages: [userMessage(id, text)] });
  assert.ok(appended.ok); return { conversationId, messageId: id };
}
export async function learningFixture(replies: readonly FakeReply[] = [toolTurn('lookup_item', { id: 'a' }), done], overrides: Partial<ViperEngineOptions> = {}) {
  const f = await headlessFixture([]); const model = anthropic(replies);
  const host = engine(f.db.pool, f.connectionId, model.model, overrides);
  const conversation = await f.client.createConversation({ title: 'Learning fixture' });
  const run = await f.client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text: 'Check stock' }] } }, 'learning-once');
  await host.runOnce('learning-worker');
  const learning = createEngineLearning(f.db.pool); const recall = createEngineRecall(f.db.pool);
  return { ...f, host, model, run, learning, recall,
    statement: (id: string, text = candidate) => appendStatement(f.db.pool, run.conversationId, id, text),
    async close() { await host.close(); await f.close(); } };
}
export async function pending(f: Awaited<ReturnType<typeof learningFixture>>, text = candidate) {
  const source = await f.statement('feedback-message', 'Hasil tugas telah saya periksa dan sesuai.');
  const feedback = await f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 0, verdict: 'confirmed', source });
  return f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: feedback.revision, text });
}
