import { parseId } from '../../../contracts/identity/ids.js';
import { assertTrustedScope } from '../../../contracts/identity/scope.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { FeedbackInput, LearningStore, OutcomeFeedback, ProposalChange, ProposalInput, ProposalReview } from '../../../contracts/learning/ports.js';
import { feedbackInput, proposalInput, proposalReview } from '../../../contracts/learning/validation.js';
import { recallLimit } from '../../../contracts/recall/validation.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { proposalRow, PROPOSAL_STATUSES } from '../postgres/learning-rows.js';
import { page } from '../postgres/recall-rows.js';
import { asRow, integer, member, ownerColumns, text } from '../postgres/rows.js';
import { withSnapshot, withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { getProposal, latestFeedback, OWNER, postRunStatement } from './learning-evidence.js';
import { propose, review } from './learning-proposals.js';
import { lockRun } from './run-store.js';

function nextFeedback(previous: StateResult<OutcomeFeedback>, expected: number): StateResult<number> {
  if (!previous.ok) return expected === 0 ? stateOk(1) : previous;
  if (expected === 0) return stateConflict({ code: 'revision_conflict', message: 'Feedback already exists', currentRevision: previous.value.revision });
  const conflict = checkExpectedRevision(previous.value.revision, expected);
  if (conflict !== undefined) return stateConflict(conflict);
  if (previous.value.revision >= 128) return stateConflict({ code: 'invalid_transition', message: 'Feedback revision limit reached' });
  return stateOk(previous.value.revision + 1);
}

async function record(tx: SqlQueryable, scope: TrustedScope, input: FeedbackInput, at: number): Promise<StateResult<OutcomeFeedback>> {
  const run = await lockRun(tx, scope, parseId('run', input.runId), () => at);
  if (!run.ok) return run;
  if (!isTerminalRunStatus(run.value.record.status)) return stateConflict({ code: 'invalid_transition', message: 'Feedback requires terminal run' });
  const next = nextFeedback(await latestFeedback(tx, scope, input.runId), input.expectedRevision);
  if (!next.ok) return next;
  const statement = await postRunStatement(tx, scope, input.runId, input.source);
  if (!statement.ok) return statement;
  await tx.query(`INSERT INTO viper_engine.outcome_feedback (run_id, actor_id, app_id, tenant_key, conversation_id, source_message_id,
    revision, verdict, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [input.runId, ...ownerColumns(scope), input.source.conversationId, input.source.messageId, next.value, input.verdict, at]);
  return latestFeedback(tx, scope, input.runId);
}

export class SqliteLearningStore implements LearningStore {
  constructor(private readonly pool: SqlPool) {}

  feedback(scope: TrustedScope, runId: string) {
    assertTrustedScope(scope);
    return latestFeedback(this.pool, scope, parseId('run', runId));
  }

  recordFeedback(scope: TrustedScope, input: FeedbackInput, at: number) {
    assertTrustedScope(scope);
    const checked = feedbackInput(input);
    return withTransaction(this.pool, tx => record(tx, scope, checked, at));
  }

  propose(scope: TrustedScope, id: string, input: ProposalInput, at: number) {
    assertTrustedScope(scope);
    const proposalId = parseId('proposal', id);
    const checked = proposalInput(input);
    return withTransaction(this.pool, tx => propose(tx, scope, proposalId, checked, at));
  }

  get(scope: TrustedScope, id: string) {
    assertTrustedScope(scope);
    return getProposal(this.pool, scope, parseId('proposal', id));
  }

  list(scope: TrustedScope, runId: string, limit: number) {
    assertTrustedScope(scope);
    const id = parseId('run', runId);
    const size = recallLimit(limit);
    return withSnapshot(this.pool, async tx => {
      const run = await tx.query(`SELECT id FROM viper_engine.runs WHERE ${OWNER} AND id = ?`, [...ownerColumns(scope), id]);
      if (run.rows[0] === undefined) return stateConflict<never>({ code: 'not_found', message: 'Run not found' });
      const result = await tx.query(`SELECT * FROM viper_engine.memory_proposals WHERE ${OWNER} AND run_id = ?
        ORDER BY created_at_ms DESC, id LIMIT ?`, [...ownerColumns(scope), id, size + 1]);
      return stateOk(page(result.rows.map(proposalRow), size));
    });
  }

  review(scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number) {
    assertTrustedScope(scope);
    const proposalId = parseId('proposal', id);
    const note = parseId('note', noteId);
    const checked = proposalReview(input);
    return withTransaction(this.pool, tx => review(tx, scope, proposalId, checked, note, at));
  }

  changes(scope: TrustedScope, id: string, limit: number) {
    assertTrustedScope(scope);
    const proposalId = parseId('proposal', id);
    const size = recallLimit(limit);
    return withSnapshot(this.pool, async tx => {
      const current = await getProposal(tx, scope, proposalId);
      if (!current.ok) return current;
      const result = await tx.query(`SELECT * FROM viper_engine.memory_proposal_changes WHERE ${OWNER} AND proposal_id = ?
        ORDER BY revision DESC LIMIT ?`, [...ownerColumns(scope), proposalId, size + 1]);
      const entries: ProposalChange[] = result.rows.map(value => {
        const row = asRow(value);
        return Object.freeze({ revision: integer(row, 'revision'), status: member(row, 'status', PROPOSAL_STATUSES),
          at: integer(row, 'created_at_ms'), ...(row['note_id'] === null ? {} : { noteId: text(row, 'note_id') }) });
      });
      return stateOk(page(entries, size));
    });
  }
}
