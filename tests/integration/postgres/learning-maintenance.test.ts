import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner } from './fixtures.js';
import { learningFixture, pending, candidate } from './learning-fixtures.js';
import { crashWorker } from '../../support/durable/process.js';

test('feedback revision atomically stales pending/accepted proposals and retires only unedited promoted notes', async () => {
  const f = await learningFixture();
  try {
    const first = await pending(f); const confirmation = await f.statement('confirmation');
    const accepted = await f.learning.review(owner, first.proposalId, { expectedRevision: 1, digest: first.digest, decision: 'accept', confirmation }); assert.ok(accepted.noteId);
    const second = await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: 'Second reviewed statement' });
    const source2 = await f.statement('confirmation-2', second.text);
    const accepted2 = await f.learning.review(owner, second.proposalId, { expectedRevision: 1, digest: second.digest, decision: 'accept', confirmation: source2 }); assert.ok(accepted2.noteId);
    const corrected = await f.statement('correction', 'Independent user correction');
    await f.recall.correctNote(owner, accepted2.noteId, 1, corrected);
    const third = await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: 'Pending candidate' });
    const dispute = await f.statement('dispute', 'Saya merevisi penilaian hasil sebelumnya.');
    const next = await f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 1, verdict: 'disputed', source: dispute }); assert.equal(next.revision, 2);
    const all = await f.learning.proposals(owner, f.run.runId); assert.ok(all.items.every(item => item.status === 'stale'));
    assert.equal((await f.recall.getNote(owner, accepted.noteId)).status, 'deleted');
    assert.equal((await f.recall.getNote(owner, accepted2.noteId)).text, 'Independent user correction');
    assert.deepEqual((await f.recall.changes(owner, accepted.noteId)).items.map(item => item.action), ['deleted', 'created']);
    assert.deepEqual((await f.learning.changes(owner, first.proposalId)).items.map(item => item.status), ['stale', 'accepted', 'pending']);
    await assert.rejects(f.learning.review(owner, third.proposalId, { expectedRevision: 2, digest: third.digest, decision: 'accept', confirmation }), /INVALID_STATE/);
    await assert.rejects(f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 2, text: candidate }), /INVALID_STATE/);
    await assert.rejects(f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 1, verdict: 'confirmed', source: confirmation }), /REVISION_CONFLICT/);
    await f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 2, verdict: 'confirmed', source: confirmation });
    const fresh = await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 3, text: candidate });
    assert.notEqual(fresh.digest, first.digest); assert.equal(fresh.status, 'pending');
    assert.equal((await f.learning.getProposal(owner, first.proposalId)).status, 'stale');
  } finally { await f.close(); }
});

test('concurrent feedback replacement has one CAS winner and one invalidation audit', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const source = await f.statement('revised-feedback', 'Revised feedback');
    const results = await Promise.allSettled(['confirmed', 'disputed'].map(verdict => f.learning.recordFeedback(owner,
      { runId: f.run.runId, expectedRevision: 1, verdict: verdict as 'confirmed' | 'disputed', source })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await f.learning.feedback(owner, f.run.runId)).revision, 2);
    assert.deepEqual((await f.learning.changes(owner, proposal.proposalId)).items.map(item => item.status), ['stale', 'pending']);
    assert.equal((await f.recall.notes(owner)).items.length, 0);
  } finally { await f.close(); }
});

test('actual process kill before/after commit cannot leave half a promotion or duplicate accepted notes', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const confirmation = await f.statement('confirmation');
    await crashWorker(f.db.name, 'before', 'promotion-before-commit', 'tests/support/durable/learning-worker.ts');
    assert.equal((await f.learning.getProposal(owner, proposal.proposalId)).status, 'pending');
    assert.equal((await f.recall.notes(owner)).items.length, 0); assert.equal((await f.learning.changes(owner, proposal.proposalId)).items.length, 1);
    await crashWorker(f.db.name, 'after', 'promotion-after-commit', 'tests/support/durable/learning-worker.ts');
    const restored = await f.learning.getProposal(owner, proposal.proposalId); assert.equal(restored.status, 'accepted'); assert.ok(restored.noteId);
    assert.equal((await f.recall.getNote(owner, restored.noteId)).text, candidate);
    assert.equal((await f.recall.notes(owner)).items.length, 1); assert.equal((await f.learning.changes(owner, proposal.proposalId)).items.length, 2);
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation }), /REVISION_CONFLICT/);
  } finally { await f.close(); }
});
