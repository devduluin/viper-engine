import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NoteSource } from '../../../contracts/recall/ports.js';
import { stateConflict, stateOk, checkExpectedRevision } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import type { SqlQueryable } from './sql-client.js';
import { asRow, text, ownerColumns } from './rows.js';
import { latestFeedback } from './learning-rows.js';
import { userStatement } from './user-statement.js';

export async function postRunStatement(tx: SqlQueryable, scope: TrustedScope, runId: string, source: NoteSource) {
  const statement = await userStatement(tx, scope, source); if (!statement.ok) return statement;
  const result = await tx.query('SELECT viper_engine.learning_source_after($1, $2) AS valid', [runId, source.messageId]);
  if (asRow(result.rows[0])['valid'] !== true) return stateConflict<never>({ code: 'evidence_required', message: 'Select a statement after this run in its conversation' });
  return statement;
}
export async function outcomeEvidence(tx: SqlQueryable, scope: TrustedScope, runId: string, revision: number): Promise<StateResult<{ readonly finalMessageId: string; readonly digest: string }>> {
  const feedback = await latestFeedback(tx, scope, runId); if (!feedback.ok) return feedback;
  const conflict = checkExpectedRevision(feedback.value.revision, revision); if (conflict !== undefined) return stateConflict(conflict);
  const valid = await tx.query('SELECT viper_engine.learning_eligible($1) AS eligible', [runId]);
  if (feedback.value.verdict !== 'confirmed' || asRow(valid.rows[0])['eligible'] !== true) return stateConflict({ code: 'evidence_required', message: 'Completed clean run and explicit current feedback required' });
  const final = await tx.query('SELECT id, content FROM viper_engine.messages WHERE run_id = $1 ORDER BY position DESC LIMIT 1', [runId]);
  const row = asRow(final.rows[0]);
  const models = await tx.query('SELECT id, step_id, attempt, provider, model, outcome FROM viper_engine.model_calls WHERE run_id = $1 ORDER BY id', [runId]);
  const tools = await tx.query(`SELECT id, step_id, status, attempts, connection_id, server_id, tool_name, definition_version, arguments_digest
    FROM viper_engine.tool_calls WHERE run_id = $1 ORDER BY id`, [runId]);
  const attempts = await tx.query('SELECT tool_call_id, attempt, result_kind FROM viper_engine.tool_call_attempts WHERE run_id = $1 ORDER BY tool_call_id, attempt', [runId]);
  const run = await tx.query('SELECT revision, last_event_sequence FROM viper_engine.runs WHERE id = $1', [runId]);
  const digest = createFingerprint({ owner: ownerColumns(scope), runId, run: run.rows[0], final: row, models: models.rows, tools: tools.rows, attempts: attempts.rows, feedback: feedback.value },
    { domain: 'learning.outcome', version: '1' });
  return stateOk({ finalMessageId: text(row, 'id'), digest });
}
