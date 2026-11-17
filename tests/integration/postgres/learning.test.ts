import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner, other, tenanted } from './fixtures.js';
import { testScope } from '../../support/agent/setup.js';
import { ApiFailure } from '../../../src/contracts/api/failure.js';
import { learningFixture, pending, candidate } from './learning-fixtures.js';
import { recallConversation } from './recall-fixtures.js';

const missing = (error: unknown) => error instanceof ApiFailure && error.code === 'NOT_FOUND';
const stale = (error: unknown) => error instanceof ApiFailure && error.code === 'REVISION_CONFLICT';

test('actual SDK/MCP outcome produces only a pending proposal until exact user confirmation, with dedup and metadata audit', async () => {
  const f = await learningFixture();
  try {
    assert.equal((await f.client.run(f.run.runId)).status, 'completed');
    await assert.rejects(f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: candidate }), missing);
    const proposal = await pending(f); assert.equal(proposal.status, 'pending'); assert.equal(proposal.trust, 'unverified_proposal');
    assert.equal(f.model.api.bodies.length, 2); assert.deepEqual(f.effects.calls, ['lookup_item']);
    const repeated = await Promise.all([1, 2].map(() => f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: candidate })));
    assert.ok(repeated.every(item => item.proposalId === proposal.proposalId));
    assert.equal((await f.recall.notes(owner)).items.length, 0); assert.deepEqual(await f.recall.evidence(owner), []);
    const vague = await f.statement('vague', 'OK');
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation: vague }), /INVALID_STATE/);
    const confirmation = await f.statement('confirmation');
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: 'b'.repeat(64), decision: 'accept', confirmation }), /INVALID_STATE/);
    const accepted = await f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation });
    assert.equal(accepted.status, 'accepted'); assert.ok(accepted.noteId);
    const note = await f.recall.getNote(owner, accepted.noteId); assert.equal(note.text, candidate); assert.equal(note.trust, 'user_asserted');
    assert.equal(note.source?.messageId, confirmation.messageId); assert.equal((await f.recall.notes(owner)).items.length, 1);
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation }), stale);
    const audit = await f.learning.changes(owner, proposal.proposalId); assert.deepEqual(audit.items.map(item => item.status), ['accepted', 'pending']);
    assert.ok(!JSON.stringify(audit).includes(candidate));
    assert.equal((await f.learning.proposals(owner, f.run.runId, 1)).hasMore, false);
  } finally { await f.close(); }
});

test('learning scope protects feedback, proposal, review and audit across actors, apps, tenants and sources', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const confirmation = await f.statement('confirmation');
    for (const scope of [other, tenanted, testScope('actor-a', 'other-app')]) {
      await assert.rejects(f.learning.feedback(scope, f.run.runId), missing);
      await assert.rejects(f.learning.getProposal(scope, proposal.proposalId), missing);
      await assert.rejects(f.learning.proposals(scope, f.run.runId), missing);
      await assert.rejects(f.learning.changes(scope, proposal.proposalId), missing);
      await assert.rejects(f.learning.propose(scope, { runId: f.run.runId, feedbackRevision: 1, text: candidate }), missing);
      await assert.rejects(f.learning.recordFeedback(scope, { runId: f.run.runId, expectedRevision: 1, verdict: 'confirmed', source: confirmation }), missing);
      await assert.rejects(f.learning.review(scope, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation }), missing);
    }
    const foreign = await recallConversation(f.db.pool, 'foreign-learning', other);
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation: foreign }), missing);
    const history = await f.client.conversation(f.run.conversationId); const assistant = history.messages.find(message => message.role === 'assistant'); assert.ok(assistant);
    await assert.rejects(f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 1, verdict: 'confirmed', source: { conversationId: f.run.conversationId, messageId: assistant.id } }), /INVALID_STATE/);
    const initial = history.messages.find(message => message.role === 'user'); assert.ok(initial);
    await assert.rejects(f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 1, verdict: 'confirmed', source: { conversationId: f.run.conversationId, messageId: initial.id } }), /INVALID_STATE/);
    assert.equal((await f.recall.notes(owner)).items.length, 0);
  } finally { await f.close(); }
});

test('review CAS has one winner; rejection stays terminal and audit is immutable', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const confirmation = await f.statement('confirmation');
    const results = await Promise.allSettled([1, 2].map(() => f.learning.review(owner, proposal.proposalId,
      { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await f.recall.notes(owner)).items.length, 1); assert.equal((await f.learning.changes(owner, proposal.proposalId)).items.length, 2);
    const second = await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: 'Other candidate' });
    const rejected = await f.learning.review(owner, second.proposalId, { expectedRevision: 1, digest: second.digest, decision: 'reject' }); assert.equal(rejected.status, 'rejected');
    await assert.rejects(f.learning.review(owner, second.proposalId, { expectedRevision: 2, digest: second.digest, decision: 'accept', confirmation }), /INVALID_STATE/);
    await assert.rejects(f.db.pool.query("UPDATE viper_engine.memory_proposal_changes SET status = 'accepted' WHERE proposal_id = $1", [second.proposalId]), /immutable|append|updated/i);
    await assert.rejects(f.db.pool.query("UPDATE viper_engine.outcome_feedback SET verdict = 'disputed' WHERE run_id = $1", [f.run.runId]), /immutable|append|updated/i);
    await assert.rejects(f.db.pool.query("UPDATE viper_engine.memory_proposals SET candidate_text = 'mutated', revision = revision + 1 WHERE id = $1", [second.proposalId]), /immutable|transition/i);
  } finally { await f.close(); }
});
