import assert from 'node:assert/strict';
import { owner } from '../tests/integration/postgres/fixtures.js';
import { learningFixture, pending } from '../tests/integration/postgres/learning-fixtures.js';

// Explicit isolated VIPER_TEST_DB_* only; synthetic feedback and scripted SDK/MCP, no .env/key.
const f = await learningFixture();
try {
  const proposal = await pending(f);
  assert.equal((await f.recall.notes(owner)).items.length, 0);
  const confirmation = await f.statement('confirmation');
  const accepted = await f.learning.review(owner, proposal.proposalId,
    { expectedRevision: proposal.revision, digest: proposal.digest, decision: 'accept', confirmation });
  assert.ok(accepted.noteId); assert.equal((await f.recall.getNote(owner, accepted.noteId)).trust, 'user_asserted');
  const feedback = await f.statement('disputed', 'Synthetic correction: previous outcome no longer accepted.');
  await f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 1, verdict: 'disputed', source: feedback });
  const current = await f.learning.getProposal(owner, proposal.proposalId);
  const note = await f.recall.getNote(owner, accepted.noteId);
  assert.equal(current.status, 'stale'); assert.equal(note.status, 'deleted');
  console.log(JSON.stringify({ run: (await f.client.run(f.run.runId)).status, modelCalls: f.model.api.bodies.length,
    toolCalls: f.effects.calls.length, proposal: current.status, note: note.status,
    audit: (await f.learning.changes(owner, proposal.proposalId)).items.map(item => item.status) }));
} finally { await f.close(); }
