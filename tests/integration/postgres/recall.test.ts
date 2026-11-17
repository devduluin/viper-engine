import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { owner, other, tenanted } from './fixtures.js';
import { createEngineRecall } from '../../../src/bootstrap/recall.js';
import { recallConversation, userMessage } from './recall-fixtures.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';
import { historicalRun } from './context-fixtures.js';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { anthropic, done } from './engine-fixtures.js';
import { engine } from './engine-fixtures.js';
import { testScope } from '../../support/agent/setup.js';

const missing = (error: unknown) => error instanceof ApiFailure && error.code === 'NOT_FOUND';

test('scoped literal history search never leaks actor/app/tenant, bounds excerpts and treats SQL text as data', async () => {
  const db = await createDatabase(); const recall = createEngineRecall(db.pool);
  try {
    const own = await recallConversation(db.pool, 'own', owner, [userMessage('own-1', 'Needle '.repeat(500)), userMessage('own-2', 'Needle second')]);
    await recallConversation(db.pool, 'other', other, [userMessage('other-message', 'Needle PRIVATE_OTHER')]);
    await recallConversation(db.pool, 'tenant', tenanted, [userMessage('tenant-message', 'Needle PRIVATE_TENANT')]);
    await recallConversation(db.pool, 'app', testScope('actor-a', 'other-app'), [userMessage('app-message', 'Needle PRIVATE_APP')]);
    const found = await recall.search(owner, { query: 'needle', limit: 1 }); assert.equal(found.items.length, 1); assert.equal(found.hasMore, true);
    assert.ok(found.items.every(item => item.conversationId === own.conversationId && item.excerpt.length <= 512));
    assert.equal(found.items[0]?.trust, 'untrusted_history');
    assert.deepEqual((await recall.search(owner, { query: 'Needle', conversationId: 'recall-other' })).items, []);
    assert.deepEqual((await recall.search(owner, { query: "%' OR 1=1 --" })).items, []);
    assert.deepEqual((await recall.search(owner, { query: 'PRIVATE' })).items, []);
  } finally { await db.drop(); }
});

test('explicit notes preserve source, CAS correction, metadata-only revisions and deletion without copying user text', async () => {
  const db = await createDatabase(); const recall = createEngineRecall(db.pool);
  try {
    const first = await recallConversation(db.pool, 'note-first'); const second = await recallConversation(db.pool, 'note-second', owner,
      [userMessage('corrected-source', 'Preference corrected: English')]);
    const created = await recall.createNote(owner, first); assert.equal(created.text, 'Preference: Indonesian, concise answers');
    assert.equal(created.trust, 'user_asserted'); assert.equal(created.source?.messageId, first.messageId);
    const corrected = await recall.correctNote(owner, created.noteId, created.revision, second); assert.equal(corrected.text, 'Preference corrected: English');
    await assert.rejects(recall.correctNote(owner, created.noteId, created.revision, first), error => error instanceof ApiFailure && error.code === 'REVISION_CONFLICT');
    const changes = await recall.changes(owner, created.noteId); assert.deepEqual(changes.items.map(item => item.action), ['corrected', 'created']);
    assert.ok(!JSON.stringify(changes).includes('Preference'));
    const deleted = await recall.deleteNote(owner, created.noteId, corrected.revision); assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.text, undefined); assert.equal(deleted.source, undefined);
    assert.equal((await recall.notes(owner)).items.length, 0); assert.deepEqual(await recall.evidence(owner), []);
    const current = await recall.getNote(owner, created.noteId); assert.equal(current.status, 'deleted');
    assert.ok((await recall.search(owner, { query: 'Preference' })).items.length > 0, 'note deletion does not erase immutable conversation history');
    await assert.rejects(recall.correctNote(owner, created.noteId, deleted.revision, first), /INVALID_STATE/);
    const columns = await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'viper_engine' AND table_name LIKE 'memory_note%'");
    assert.ok(columns.rows.every(row => !['text', 'content'].includes(row.column_name)));
  } finally { await db.drop(); }
});

test('note ownership applies to read, changes, correction, deletion and source selection; assistant answers cannot become notes', async () => {
  const f = await headlessFixture([]); const recall = createEngineRecall(f.db.pool); const model = anthropic([done]);
  const host = engine(f.db.pool, f.connectionId, model.model);
  try {
    const own = await recallConversation(f.db.pool, 'source-own'); const foreign = await recallConversation(f.db.pool, 'source-foreign', other);
    const note = await recall.createNote(owner, own);
    for (const scope of [other, tenanted, testScope('actor-a', 'other-app')]) {
      await assert.rejects(recall.getNote(scope, note.noteId), missing); await assert.rejects(recall.changes(scope, note.noteId), missing);
      await assert.rejects(recall.correctNote(scope, note.noteId, note.revision, foreign), missing);
      await assert.rejects(recall.deleteNote(scope, note.noteId, note.revision), missing);
      assert.deepEqual((await recall.notes(scope)).items, []);
    }
    await assert.rejects(recall.createNote(owner, foreign), missing);
    const run = await historicalRun(f.db.pool, f.client); await host.runOnce('recall-answer');
    const history = await f.client.conversation(run.conversationId); const generated = history.messages.find(message => message.role === 'assistant'); assert.ok(generated);
    await assert.rejects(recall.createNote(owner, { conversationId: run.conversationId, messageId: generated.id }), /INVALID_STATE/);
    assert.equal((await recall.notes(owner)).items.length, 1);
    await assert.rejects(f.db.pool.query(`INSERT INTO viper_engine.memory_notes (id, actor_id, app_id, tenant_key, source_message_id, source_conversation_id, created_at, updated_at)
      VALUES ('forged-note', $1, $2, '', $3, $4, now(), now())`, [owner.actorId, owner.appId, generated.id, run.conversationId]), /foreign key/);
  } finally { await host.close(); await f.close(); }
});

test('two note corrections at the same revision have one winner and exactly one audit change', async () => {
  const db = await createDatabase(); const recall = createEngineRecall(db.pool);
  try {
    const source = await recallConversation(db.pool, 'race-source'); const note = await recall.createNote(owner, source);
    const a = await recallConversation(db.pool, 'race-a', owner, [userMessage('race-a-message', 'Preference A')]);
    const b = await recallConversation(db.pool, 'race-b', owner, [userMessage('race-b-message', 'Preference B')]);
    const results = await Promise.allSettled([recall.correctNote(owner, note.noteId, 1, a), recall.correctNote(owner, note.noteId, 1, b)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal((await recall.changes(owner, note.noteId)).items.length, 2);
    await assert.rejects(db.pool.query("UPDATE viper_engine.memory_note_changes SET action = 'deleted' WHERE note_id = $1", [note.noteId]), /immutable|append|updated/i);
    assert.equal((await recall.getNote(owner, note.noteId)).revision, 2);
    await assert.rejects(recall.createNote(owner, { conversationId: source.conversationId, messageId: parseId('message', 'absent') }), missing);
  } finally { await db.drop(); }
});
