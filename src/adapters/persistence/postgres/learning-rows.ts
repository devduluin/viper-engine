import type { MemoryProposal, OutcomeFeedback, ProposalStatus } from '../../../contracts/learning/ports.js';
import { asRow, text, integer, member, msColumn, ownerColumns } from './rows.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { SqlQueryable } from './sql-client.js';
import { stateOk, stateConflict } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'accepted', 'rejected', 'stale'];
export const LEARNING_OWNER = 'actor_id = $1 AND app_id = $2 AND tenant_key = $3';
export const PROPOSAL_SELECT = `SELECT *, ${msColumn('created_at')}, ${msColumn('updated_at')} FROM viper_engine.memory_proposals`;

export function proposalRow(value: unknown): MemoryProposal {
  const row = asRow(value);
  const accepted = row['note_id'] === null ? {} : { noteId: text(row, 'note_id'), noteRevision: integer(row, 'note_revision'),
    confirmation: Object.freeze({ conversationId: text(row, 'conversation_id'), messageId: text(row, 'confirmation_message_id') }) };
  return Object.freeze({ schemaVersion: 1, proposalId: text(row, 'id'), revision: integer(row, 'revision'),
    status: member(row, 'status', PROPOSAL_STATUSES), trust: 'unverified_proposal', runId: text(row, 'run_id'), conversationId: text(row, 'conversation_id'),
    feedbackRevision: integer(row, 'feedback_revision'), finalMessageId: text(row, 'final_message_id'), text: text(row, 'candidate_text'),
    digest: text(row, 'proposal_digest'), evidenceDigest: text(row, 'evidence_digest'), createdAt: integer(row, 'created_at_ms'), updatedAt: integer(row, 'updated_at_ms'), ...accepted });
}
export function feedbackRow(value: unknown): OutcomeFeedback {
  const row = asRow(value);
  return Object.freeze({ schemaVersion: 1, runId: text(row, 'run_id'), revision: integer(row, 'revision'),
    verdict: member(row, 'verdict', ['confirmed', 'disputed'] as const), createdAt: integer(row, 'created_at_ms'),
    source: Object.freeze({ conversationId: text(row, 'conversation_id'), messageId: text(row, 'source_message_id') }) });
}
export async function getProposal(tx: SqlQueryable, scope: TrustedScope, id: string): Promise<StateResult<MemoryProposal>> {
  const result = await tx.query(`${PROPOSAL_SELECT} WHERE ${LEARNING_OWNER} AND id = $4`, [...ownerColumns(scope), id]);
  return result.rows[0] === undefined ? stateConflict({ code: 'not_found', message: 'Proposal not found' }) : stateOk(proposalRow(result.rows[0]));
}
export async function latestFeedback(tx: SqlQueryable, scope: TrustedScope, runId: string): Promise<StateResult<OutcomeFeedback>> {
  const result = await tx.query(`SELECT *, ${msColumn('created_at')} FROM viper_engine.outcome_feedback
    WHERE ${LEARNING_OWNER} AND run_id = $4 ORDER BY revision DESC LIMIT 1`, [...ownerColumns(scope), runId]);
  return result.rows[0] === undefined ? stateConflict({ code: 'not_found', message: 'Feedback not found' }) : stateOk(feedbackRow(result.rows[0]));
}
