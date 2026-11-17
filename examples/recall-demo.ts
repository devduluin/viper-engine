import { createEngineRecall } from '../src/index.js';
import { headlessFixture } from '../tests/support/client/headless-fixture.js';
import { recallConversation, userMessage } from '../tests/integration/postgres/recall-fixtures.js';
import { owner } from '../tests/integration/postgres/fixtures.js';
import { engine, anthropic, done, toolTurn } from '../tests/integration/postgres/engine-fixtures.js';

// Explicit VIPER_TEST_DB_* only; no .env, key or live provider. Sources are synthetic user statements.
const fixture = await headlessFixture([]); const recall = createEngineRecall(fixture.db.pool);
const source = await recallConversation(fixture.db.pool, 'recall-demo', owner, [userMessage('demo-source', 'Preference: concise Indonesian')]);
const note = await recall.createNote(owner, source);
const model = anthropic([toolTurn('lookup_item', { id: 'a' }), done]);
const host = engine(fixture.db.pool, fixture.connectionId, model.model, {
  contextEvidence: request => recall.evidence(request.scope),
});
try {
  const conversation = await fixture.client.createConversation();
  await fixture.client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text: 'Read item a' }] } }, 'recall-demo');
  const result = await host.runOnce('recall-demo');
  const search = await recall.search(owner, { query: 'Preference' });
  const correctedSource = await recallConversation(fixture.db.pool, 'recall-demo-corrected', owner,
    [userMessage('demo-corrected', 'Preference: concise English')]);
  const corrected = await recall.correctNote(owner, note.noteId, note.revision, correctedSource);
  await recall.deleteNote(owner, note.noteId, corrected.revision);
  const remaining = await recall.notes(owner);
  console.log(JSON.stringify({ status: result.kind === 'settled' ? result.status : result.kind, searchHits: search.items.length,
    modelCalls: model.api.bodies.length, toolCalls: fixture.effects.calls.length, remainingNotes: remaining.items.length,
    changes: (await recall.changes(owner, note.noteId)).items.map(change => change.action) }));
  if (result.kind !== 'settled' || result.status !== 'completed' || remaining.items.length !== 0) process.exitCode = 1;
} finally { await host.close(); await fixture.close(); }
