import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NoteSource } from '../../../contracts/recall/ports.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { feedbackRow, proposalRow } from '../postgres/learning-rows.js';
import { asRow, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { userStatement } from './recall-queries.js';

export const OWNER = 'actor_id = ? AND app_id = ? AND tenant_key = ?';

export async function latestFeedback(tx: SqlQueryable, scope: TrustedScope, runId: string) {
  const row = (await tx.query(`SELECT * FROM viper_engine.outcome_feedback WHERE ${OWNER} AND run_id = ?
    ORDER BY revision DESC LIMIT 1`, [...ownerColumns(scope), runId])).rows[0];
  return row === undefined ? stateConflict<never>({ code: 'not_found', message: 'Feedback not found' }) : stateOk(feedbackRow(row));
}

export async function getProposal(tx: SqlQueryable, scope: TrustedScope, id: string) {
  const row = (await tx.query(`SELECT * FROM viper_engine.memory_proposals WHERE ${OWNER} AND id = ?`, [...ownerColumns(scope), id])).rows[0];
  return row === undefined ? stateConflict<never>({ code: 'not_found', message: 'Proposal not found' }) : stateOk(proposalRow(row));
}

export async function postRunStatement(tx: SqlQueryable, scope: TrustedScope, runId: string, source: NoteSource) {
  const statement = await userStatement(tx, scope, source);
  if (!statement.ok) return statement;
  const result = await tx.query(`SELECT r.id FROM viper_engine.runs r WHERE r.id = ? AND r.conversation_id = ?
    AND ? > (SELECT max(position) FROM viper_engine.messages WHERE run_id = r.id)`,
  [runId, source.conversationId, statement.value.source.position]);
  return result.rows.length === 0 ? stateConflict<never>({
    code: 'evidence_required', message: 'Select a statement after this run in its conversation',
  }) : statement;
}

export async function outcomeEvidence(tx: SqlQueryable, scope: TrustedScope, runId: string, revision: number): Promise<StateResult<{
  readonly finalMessageId: string; readonly digest: string;
}>> {
  const feedback = await latestFeedback(tx, scope, runId);
  if (!feedback.ok) return feedback;
  const conflict = checkExpectedRevision(feedback.value.revision, revision);
  if (conflict !== undefined) return stateConflict(conflict);
  const final = await tx.query(`SELECT m.id, m.content FROM viper_engine.learning_eligible e
    JOIN viper_engine.messages m ON m.id = e.final_message_id WHERE e.run_id = ?`, [runId]);
  if (feedback.value.verdict !== 'confirmed' || final.rows[0] === undefined) {
    return stateConflict({ code: 'evidence_required', message: 'Completed clean run and explicit current feedback required' });
  }
  const row = asRow(final.rows[0]);
  const models = await tx.query('SELECT id, step_id, attempt, provider, model, outcome FROM viper_engine.model_calls WHERE run_id = ? ORDER BY id', [runId]);
  const tools = await tx.query(`SELECT id, step_id, status, attempts, connection_id, server_id, tool_name, definition_version, arguments_digest
    FROM viper_engine.tool_calls WHERE run_id = ? ORDER BY id`, [runId]);
  const attempts = await tx.query('SELECT tool_call_id, attempt, result_kind FROM viper_engine.tool_call_attempts WHERE run_id = ? ORDER BY tool_call_id, attempt', [runId]);
  const run = await tx.query('SELECT revision, last_event_sequence FROM viper_engine.runs WHERE id = ?', [runId]);
  const digest = createFingerprint({ owner: ownerColumns(scope), runId, run: run.rows[0],
    final: { ...row, content: JSON.parse(text(row, 'content')) }, models: models.rows, tools: tools.rows, attempts: attempts.rows,
    feedback: feedback.value }, { domain: 'learning.outcome', version: '1' });
  return stateOk({ finalMessageId: text(row, 'id'), digest });
}
