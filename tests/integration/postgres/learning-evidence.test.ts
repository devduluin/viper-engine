import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner } from './fixtures.js';
import { learningFixture, pending, candidate } from './learning-fixtures.js';
import { done, toolTurn, engine, anthropic } from './engine-fixtures.js';
import { createEngineLearning } from '../../../src/bootstrap/learning.js';
import { headlessFixture } from '../../support/client/headless-fixture.js';
import { appendStatement } from './learning-fixtures.js';

test('failed provider, failed tool and unknown tool trajectories cannot become proposals despite positive feedback', async () => {
  const cases = [
    { replies: [{ status: 401, errorType: 'authentication_error' }], status: 'failed' },
    { replies: [toolTurn('lookup_item', { id: 'missing' }), done], status: 'failed' },
    { replies: [toolTurn('hang'), done], status: 'partial' },
  ];
  for (const scenario of cases) {
    const f = await learningFixture(scenario.replies, { requestTimeoutMs: 150 });
    try {
      assert.equal((await f.client.run(f.run.runId)).status, scenario.status);
      const source = await f.statement('feedback', 'Pengguna menyatakan berhasil.');
      await f.learning.recordFeedback(owner, { runId: f.run.runId, expectedRevision: 0, verdict: 'confirmed', source });
      await assert.rejects(f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: candidate }), /INVALID_STATE/);
      assert.equal((await f.learning.proposals(owner, f.run.runId)).items.length, 0); assert.equal((await f.recall.notes(owner)).items.length, 0);
    } finally { await f.close(); }
  }
});

test('queued feedback is refused and cancelled run cannot be promoted', async () => {
  const f = await headlessFixture([]); const learning = createEngineLearning(f.db.pool);
  const host = engine(f.db.pool, f.connectionId, anthropic([]).model);
  try {
    const conversation = await f.client.createConversation();
    const run = await f.client.startRun(conversation.conversationId, { input: { content: [{ type: 'text', text: 'Task' }] } }, 'cancel-learning');
    const source = await appendStatement(f.db.pool, run.conversationId, 'feedback', 'User feedback');
    await assert.rejects(learning.recordFeedback(owner, { runId: run.runId, expectedRevision: 0, verdict: 'confirmed', source }), /INVALID_STATE/);
    assert.ok((await f.client.cancel(run.runId)).cancelRequestedAt !== undefined);
    await host.runOnce('settle-cancel'); assert.equal((await f.client.run(run.runId)).status, 'cancelled');
    await learning.recordFeedback(owner, { runId: run.runId, expectedRevision: 0, verdict: 'confirmed', source });
    await assert.rejects(learning.propose(owner, { runId: run.runId, feedbackRevision: 1, text: candidate }), /INVALID_STATE/);
  } finally { await host.close(); await f.close(); }
});

test('acceptance rechecks persisted evidence; raw SQL cannot bypass confirmation or proposal identity', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const confirmation = await f.statement('confirmation');
    await assert.rejects(f.db.pool.query(`UPDATE viper_engine.memory_proposals SET status = 'accepted', revision = revision + 1 WHERE id = $1`, [proposal.proposalId]), /confirmation|matching note/i);
    await assert.rejects(f.db.pool.query(`UPDATE viper_engine.memory_proposals SET final_message_id = $2, revision = revision + 1, status = 'rejected' WHERE id = $1`, [proposal.proposalId, confirmation.messageId]), /immutable/i);
    await f.db.pool.query("UPDATE viper_engine.model_calls SET outcome = 'failed', failure_code = 'fixture_corruption' WHERE run_id = $1", [f.run.runId]);
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation }), /INVALID_STATE/);
    assert.equal((await f.learning.getProposal(owner, proposal.proposalId)).status, 'pending');
    assert.equal((await f.recall.notes(owner)).items.length, 0);
  } finally { await f.close(); }
});

test('per-run candidates stay bounded, paginate deterministically and duplicate creation remains idempotent at the cap', async () => {
  const f = await learningFixture([done]);
  try {
    const first = await pending(f);
    for (let i = 1; i < 32; i++) await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: `Candidate ${i}` });
    const list = await f.learning.proposals(owner, f.run.runId, 5); assert.equal(list.items.length, 5); assert.equal(list.hasMore, true);
    assert.deepEqual((await f.learning.proposals(owner, f.run.runId, 5)).items.map(item => item.proposalId), list.items.map(item => item.proposalId));
    assert.equal((await f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: candidate })).proposalId, first.proposalId);
    await assert.rejects(f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: 'Candidate beyond limit' }), /INVALID_STATE/);
  } finally { await f.close(); }
});

test('a succeeded tool row without its dispatch audit is unverified and cannot certify a proposal', async () => {
  const f = await learningFixture();
  try {
    const proposal = await pending(f); const confirmation = await f.statement('confirmation');
    await f.db.pool.query(`INSERT INTO viper_engine.tool_calls
      (run_id, id, actor_id, app_id, tenant_key, step_id, status, attempts, connection_id, server_id, tool_name, definition_version, arguments_digest, requires_approval)
      SELECT run_id, 'missing-dispatch-audit', actor_id, app_id, tenant_key, step_id, status, attempts,
      connection_id, server_id, tool_name, definition_version, arguments_digest, requires_approval FROM viper_engine.tool_calls WHERE run_id = $1 LIMIT 1`, [f.run.runId]);
    await assert.rejects(f.learning.propose(owner, { runId: f.run.runId, feedbackRevision: 1, text: 'Unverified trajectory' }), /INVALID_STATE/);
    await assert.rejects(f.learning.review(owner, proposal.proposalId, { expectedRevision: 1, digest: proposal.digest, decision: 'accept', confirmation }), /INVALID_STATE/);
    assert.equal((await f.recall.notes(owner)).items.length, 0);
  } finally { await f.close(); }
});
