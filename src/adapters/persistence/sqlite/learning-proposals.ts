import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { MemoryProposal, ProposalInput, ProposalReview } from '../../../contracts/learning/ports.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { proposalRow } from '../postgres/learning-rows.js';
import { asRow, integer, ownerColumns, text } from '../postgres/rows.js';
import { transactionPool } from '../postgres/journal-commands.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { getProposal, outcomeEvidence, OWNER, postRunStatement } from './learning-evidence.js';
import { SqliteRecallStore } from './recall-store.js';

export async function propose(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalInput, at: number): Promise<StateResult<MemoryProposal>> {
  const evidence = await outcomeEvidence(tx, scope, input.runId, input.feedbackRevision);
  if (!evidence.ok) return evidence;
  const digest = createFingerprint({ owner: ownerColumns(scope), ...input, evidenceDigest: evidence.value.digest }, { domain: 'learning.proposal', version: '1' });
  const prior = (await tx.query(`SELECT * FROM viper_engine.memory_proposals WHERE ${OWNER} AND proposal_digest = ?`, [...ownerColumns(scope), digest])).rows[0];
  if (prior !== undefined) return stateOk(proposalRow(prior));
  const count = await tx.query('SELECT count(*) AS n FROM viper_engine.memory_proposals WHERE run_id = ?', [input.runId]);
  if (integer(asRow(count.rows[0]), 'n') >= 32) return stateConflict({ code: 'invalid_transition', message: 'Proposal limit reached for this run' });
  const run = asRow((await tx.query('SELECT conversation_id FROM viper_engine.runs WHERE id = ?', [input.runId])).rows[0]);
  await tx.query(`INSERT INTO viper_engine.memory_proposals (id, actor_id, app_id, tenant_key, run_id, conversation_id,
    feedback_revision, final_message_id, candidate_text, proposal_digest, evidence_digest, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, ...ownerColumns(scope), input.runId, text(run, 'conversation_id'), input.feedbackRevision, evidence.value.finalMessageId,
    input.text, digest, evidence.value.digest, at, at]);
  return getProposal(tx, scope, id);
}

export async function review(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number): Promise<StateResult<MemoryProposal>> {
  const current = await getProposal(tx, scope, id);
  if (!current.ok) return current;
  const proposal = current.value;
  const conflict = checkExpectedRevision(proposal.revision, input.expectedRevision);
  if (conflict !== undefined) return stateConflict(conflict);
  if (proposal.status !== 'pending' || proposal.digest !== input.digest) {
    return stateConflict({ code: 'invalid_transition', message: 'Exact pending proposal required' });
  }
  if (input.decision === 'accept') {
    const accepted = await accept(tx, scope, proposal, input, noteId, at);
    if (!accepted.ok) return accepted;
  }
  await settle(tx, scope, id, input, noteId, at);
  return getProposal(tx, scope, id);
}

async function settle(tx: SqlQueryable, scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number) {
  const binding = input.decision === 'accept' ? [noteId, 1, input.confirmation?.messageId ?? null] : [null, null, null];
  await tx.query(`UPDATE viper_engine.memory_proposals SET status = ?, revision = revision + 1, updated_at_ms = ?,
    note_id = ?, note_revision = ?, confirmation_message_id = ? WHERE ${OWNER} AND id = ?`,
  [input.decision === 'accept' ? 'accepted' : 'rejected', at, ...binding, ...ownerColumns(scope), id]);
}

async function accept(tx: SqlQueryable, scope: TrustedScope, proposal: MemoryProposal, input: ProposalReview, noteId: string, at: number) {
  const evidence = await outcomeEvidence(tx, scope, proposal.runId, proposal.feedbackRevision);
  if (!evidence.ok) return evidence;
  if (evidence.value.digest !== proposal.evidenceDigest || input.confirmation === undefined) {
    return stateConflict<never>({ code: 'evidence_required', message: 'Proposal evidence changed or confirmation missing' });
  }
  const statement = await postRunStatement(tx, scope, proposal.runId, input.confirmation);
  if (!statement.ok) return statement;
  if (statement.value.text !== proposal.text) return stateConflict<never>({
    code: 'evidence_required', message: 'User must confirm the exact candidate text',
  });
  return new SqliteRecallStore(transactionPool(tx)).create(scope, noteId, input.confirmation, at);
}
