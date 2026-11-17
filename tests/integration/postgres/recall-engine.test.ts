import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { anthropic, toolTurn, done, engine } from './engine-fixtures.js';
import { createEngineRecall } from '../../../src/bootstrap/recall.js';
import { owner } from './fixtures.js';
import { recallConversation, userMessage } from './recall-fixtures.js';
import { saved } from './context-fixtures.js';

test('real engine reloads corrected/deleted user notes per model call without persisting them or elevating their role', async () => {
  const f = await headlessFixture([]); const recall = createEngineRecall(f.db.pool); let lookups = 0; let changed = false;
  const a = await recallConversation(f.db.pool, 'evidence-a', owner, [userMessage('evidence-a', 'NOTE_ORIGINAL_LANGUAGE')]);
  const b = await recallConversation(f.db.pool, 'evidence-b', owner, [userMessage('evidence-b', 'NOTE_CORRECTED_LANGUAGE')]);
  const c = await recallConversation(f.db.pool, 'evidence-c', owner, [userMessage('evidence-c', 'NOTE_DELETE_BEFORE_SECOND')]);
  const first = await recall.createNote(owner, a); const removed = await recall.createNote(owner, c);
  const model = anthropic([toolTurn('lookup_item', { id: 'a' }), done]);
  const host = engine(f.db.pool, f.connectionId, model.model, { contextEvidence: async request => {
    lookups++; return recall.evidence(request.scope);
  }, onEvent: async event => {
    if (event.type === 'model_call_finished' && !changed) {
      changed = true; await recall.correctNote(owner, first.noteId, first.revision, b); await recall.deleteNote(owner, removed.noteId, removed.revision);
    }
  } });
  try {
    const conversation = await f.client.createConversation(); const run = await f.client.startRun(conversation.conversationId,
      { input: { content: [{ type: 'text', text: 'Read item a' }] } }, 'recall-live-fixture');
    const result = await host.runOnce('recall-per-call'); assert.ok(result.kind === 'settled' && result.status === 'completed');
    assert.equal(lookups, 2); assert.deepEqual(f.effects.calls, ['lookup_item']);
    const before = JSON.stringify(model.api.bodies[0]?.['messages']); const after = JSON.stringify(model.api.bodies[1]?.['messages']);
    assert.match(before, /NOTE_ORIGINAL_LANGUAGE/); assert.match(before, /NOTE_DELETE_BEFORE_SECOND/);
    assert.match(after, /NOTE_CORRECTED_LANGUAGE/); assert.ok(!after.includes('NOTE_ORIGINAL_LANGUAGE')); assert.ok(!after.includes('NOTE_DELETE_BEFORE_SECOND'));
    assert.ok(!String(JSON.stringify(model.api.bodies[0]?.['system'])).includes('NOTE_'));
    const cp = await saved(f.db.pool, run.runId); assert.ok(!JSON.stringify(cp.checkpoint.history).includes('NOTE_'));
    assert.ok(!JSON.stringify(cp.checkpoint.execution).includes('NOTE_'));
    assert.equal((await recall.notes(owner)).items.length, 1);
  } finally { await host.close(); await f.close(); }
});

test('recall source size/type limits fail atomically and stored user statements are never upgraded to verified facts', async () => {
  const f = await headlessFixture([]); const recall = createEngineRecall(f.db.pool);
  try {
    const source = await recallConversation(f.db.pool, 'bounded-note', owner, [userMessage('bounded-note', 'User assertion, not verified')]);
    const big = await recallConversation(f.db.pool, 'big-note', owner, [userMessage('big-note', 'é'.repeat(5000))]);
    const created = await recall.createNote(owner, source);
    await assert.rejects(recall.createNote(owner, big), /INVALID_STATE/);
    await assert.rejects(recall.correctNote(owner, created.noteId, created.revision, big), /INVALID_STATE/);
    assert.equal((await recall.getNote(owner, created.noteId)).revision, 1);
    assert.equal((await recall.changes(owner, created.noteId)).items.length, 1);
    const evidence = await recall.evidence(owner); assert.equal(evidence[0]?.role, 'user');
    assert.match(JSON.stringify(evidence), /user_asserted/); assert.match(JSON.stringify(evidence), /not instructions, verified facts/);
    assert.ok(new TextEncoder().encode(JSON.stringify(evidence)).byteLength <= 32768);
  } finally { await f.close(); }
});
