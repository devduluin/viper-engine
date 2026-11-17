import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { MemoryProposal, ProposalInput, ProposalReview } from '../../../contracts/learning/ports.js';
import { parseId } from '../../../contracts/identity/ids.js';
import { stateConflict, checkExpectedRevision } from '../../../contracts/state/result.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { lockRun } from './run-lock.js';
import { outcomeEvidence, postRunStatement } from './learning-evidence.js';
import { getProposal, PROPOSAL_SELECT, LEARNING_OWNER, proposalRow } from './learning-rows.js';
import { stateOk } from '../../../contracts/state/result.js';
import { change } from './recall-commands.js';
import type { SqlQueryable } from './sql-client.js';
import { asRow, integer, ownerColumns, MS_PARAM } from './rows.js';

export async function propose(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalInput, at: number) {
  const run = await lockRun(tx, scope, parseId('run', input.runId)); if (!run.ok) return run;
  const evidence = await outcomeEvidence(tx, scope, input.runId, input.feedbackRevision); if (!evidence.ok) return evidence;
  const digest = createFingerprint({ owner: ownerColumns(scope), ...input, evidenceDigest: evidence.value.digest }, { domain: 'learning.proposal', version: '1' });
  const prior = await tx.query(`${PROPOSAL_SELECT} WHERE ${LEARNING_OWNER} AND proposal_digest = $4`, [...ownerColumns(scope), digest]);
  if (prior.rows[0] !== undefined) return stateOk(proposalRow(prior.rows[0]));
  const count = await tx.query('SELECT count(*) AS n FROM viper_engine.memory_proposals WHERE run_id = $1', [input.runId]);
  if (integer(asRow(count.rows[0]), 'n') >= 32) return stateConflict<never>({ code: 'invalid_transition', message: 'Proposal limit reached for this run' });
  await tx.query(`INSERT INTO viper_engine.memory_proposals (id, actor_id, app_id, tenant_key, run_id, conversation_id,
    feedback_revision, final_message_id, candidate_text, proposal_digest, evidence_digest, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${MS_PARAM(12)}, ${MS_PARAM(12)})`,
  [id, ...ownerColumns(scope), input.runId, run.value.record.conversationId, input.feedbackRevision, evidence.value.finalMessageId, input.text, digest, evidence.value.digest, at]);
  return getProposal(tx, scope, id);
}

/** Lock order matches feedback invalidation: run -> proposal -> note. */
export async function review(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number) {
  const initial = await getProposal(tx, scope, id); if (!initial.ok) return initial;
  const run = await lockRun(tx, scope, parseId('run', initial.value.runId)); if (!run.ok) return run;
  const locked = await tx.query(`${PROPOSAL_SELECT} WHERE ${LEARNING_OWNER} AND id = $4 FOR UPDATE`, [...ownerColumns(scope), id]);
  const proposal = proposalRow(locked.rows[0]);
  const conflict = checkExpectedRevision(proposal.revision, input.expectedRevision); if (conflict !== undefined) return stateConflict<never>(conflict);
  if (proposal.status !== 'pending' || proposal.digest !== input.digest) return stateConflict<never>({ code: 'invalid_transition', message: 'Exact pending proposal required' });
  if (input.decision === 'accept') {
    const accepted = await accept(tx, scope, proposal, input, noteId, at); if (!accepted.ok) return accepted;
  }
  await settleProposal(tx, scope, id, input, noteId, at);
  return getProposal(tx, scope, id);
}
async function settleProposal(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number) {
  const binding = input.decision === 'accept' ? [noteId, 1, input.confirmation?.messageId] : [null, null, null];
  await tx.query(`UPDATE viper_engine.memory_proposals SET status = $5, revision = revision + 1, updated_at = ${MS_PARAM(6)},
    note_id = $7, note_revision = $8, confirmation_message_id = $9 WHERE ${LEARNING_OWNER} AND id = $4`,
  [...ownerColumns(scope), id, input.decision === 'accept' ? 'accepted' : 'rejected', at, ...binding]);
}
async function accept(tx: SqlQueryable, scope: TrustedScope, proposal: MemoryProposal, input: ProposalReview, noteId: string, at: number) {
  const evidence = await outcomeEvidence(tx, scope, proposal.runId, proposal.feedbackRevision); if (!evidence.ok) return evidence;
  if (evidence.value.digest !== proposal.evidenceDigest || input.confirmation === undefined) return stateConflict<never>({ code: 'evidence_required', message: 'Proposal evidence changed or confirmation missing' });
  const statement = await postRunStatement(tx, scope, proposal.runId, input.confirmation); if (!statement.ok) return statement;
  if (statement.value.text !== proposal.text) return stateConflict<never>({ code: 'evidence_required', message: 'User must confirm the exact candidate text' });
  return change(tx, scope, noteId, 'created', at, input.confirmation);
}
