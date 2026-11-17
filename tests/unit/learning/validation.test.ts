import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateText, feedbackInput, proposalInput, proposalReview } from '../../../src/contracts/learning/validation.js';

const source = { conversationId: 'conversation-a', messageId: 'message-a' };
const digest = 'a'.repeat(64);

test('learning inputs bound UTF8 bytes and forbid client-supplied verification/owner/evidence', () => {
  assert.equal(candidateText('🦊'.repeat(2048)), '🦊'.repeat(2048));
  for (const value of ['', '  \n ', '🦊'.repeat(2049), '\u0000', '\uD800', '\uDCFF', null]) assert.throws(() => candidateText(value));
  const valid = { runId: 'run-a', feedbackRevision: 1, text: 'Candidate' };
  assert.equal(proposalInput(valid).text, 'Candidate');
  for (const extra of [{ verified: true }, { actorId: 'foreign' }, { evidenceDigest: digest }, { status: 'accepted' }]) {
    assert.throws(() => proposalInput({ ...valid, ...extra }));
  }
  const forged = { ...source, role: 'user' };
  assert.throws(() => feedbackInput({ runId: 'run-a', expectedRevision: 0, verdict: 'confirmed', source: forged }));
});

test('feedback CAS starts at zero; review requires exact digest and explicit structured confirmation', () => {
  assert.equal(feedbackInput({ runId: 'run-a', expectedRevision: 0, verdict: 'disputed', source }).expectedRevision, 0);
  for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => feedbackInput({ runId: 'run-a', expectedRevision: revision, verdict: 'confirmed', source }));
  }
  assert.throws(() => proposalReview({ expectedRevision: 1, digest, decision: 'accept' }));
  assert.throws(() => proposalReview({ expectedRevision: 1, digest, decision: 'reject', confirmation: source }));
  assert.throws(() => proposalReview({ expectedRevision: 1, digest: 'short', decision: 'accept', confirmation: source }));
  const parsed = proposalReview({ expectedRevision: 1, digest, decision: 'accept', confirmation: source });
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.confirmation));
  assert.throws(() => proposalInput({ runId: 'run-a', feedbackRevision: 0, text: 'Candidate' }));
});
