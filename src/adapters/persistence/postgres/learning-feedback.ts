import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { FeedbackInput } from '../../../contracts/learning/ports.js';
import { parseId } from '../../../contracts/identity/ids.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { stateConflict, checkExpectedRevision } from '../../../contracts/state/result.js';
import { lockRun } from './run-lock.js';
import { latestFeedback } from './learning-rows.js';
import { postRunStatement } from './learning-evidence.js';
import type { SqlQueryable } from './sql-client.js';
import { MS_PARAM, ownerColumns } from './rows.js';

export async function recordFeedback(tx: SqlQueryable, scope: TrustedScope, input: FeedbackInput, at: number) {
  const run = await lockRun(tx, scope, parseId('run', input.runId)); if (!run.ok) return run;
  if (!isTerminalRunStatus(run.value.record.status)) return stateConflict<never>({ code: 'invalid_transition', message: 'Feedback requires terminal run' });
  const previous = await latestFeedback(tx, scope, input.runId);
  if (previous.ok) {
    if (input.expectedRevision === 0) return stateConflict<never>({ code: 'revision_conflict', message: 'Feedback already exists', currentRevision: previous.value.revision });
    const conflict = checkExpectedRevision(previous.value.revision, input.expectedRevision); if (conflict !== undefined) return stateConflict<never>(conflict);
  } else if (input.expectedRevision !== 0) return previous;
  const revision = previous.ok ? previous.value.revision + 1 : 1;
  if (revision > 128) return stateConflict<never>({ code: 'invalid_transition', message: 'Feedback revision limit reached' });
  const statement = await postRunStatement(tx, scope, input.runId, input.source); if (!statement.ok) return statement;
  await tx.query(`INSERT INTO viper_engine.outcome_feedback (run_id, actor_id, app_id, tenant_key, conversation_id, source_message_id, revision, verdict, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${MS_PARAM(9)})`,
  [input.runId, ...ownerColumns(scope), input.source.conversationId, input.source.messageId, revision, input.verdict, at]);
  return latestFeedback(tx, scope, input.runId);
}
