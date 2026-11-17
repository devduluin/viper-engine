import type { LearningStore, FeedbackInput, ProposalInput, ProposalReview, ProposalChange } from '../../../contracts/learning/ports.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { assertTrustedScope } from '../../../contracts/identity/scope.js';
import { parseId } from '../../../contracts/identity/ids.js';
import { feedbackInput, proposalInput, proposalReview } from '../../../contracts/learning/validation.js';
import { recallLimit } from '../../../contracts/recall/validation.js';
import { stateOk, stateConflict } from '../../../contracts/state/result.js';
import { withSnapshot, withTransaction } from './sql-client.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { latestFeedback, getProposal, proposalRow, PROPOSAL_SELECT, LEARNING_OWNER, PROPOSAL_STATUSES } from './learning-rows.js';
import { recordFeedback } from './learning-feedback.js';
import { propose, review } from './learning-proposals.js';
import { asRow, text, integer, member, ownerColumns, msColumn } from './rows.js';
import { page } from './recall-rows.js';

export class PostgresLearningStore implements LearningStore {
  constructor(private readonly pool: SqlPool) {}
  private access<T>(scope: TrustedScope, write: boolean, work: (tx: SqlQueryable) => Promise<T>) {
    assertTrustedScope(scope);
    return (write ? withTransaction : withSnapshot)(this.pool, async tx => {
      await tx.query("SET LOCAL statement_timeout = '5s'"); return work(tx);
    });
  }
  feedback(scope: TrustedScope, runId: string) {
    parseId('run', runId); return this.access(scope, false, tx => latestFeedback(tx, scope, runId));
  }
  recordFeedback(scope: TrustedScope, input: FeedbackInput, at: number) {
    input = feedbackInput(input); return this.access(scope, true, tx => recordFeedback(tx, scope, input, at));
  }
  propose(scope: TrustedScope, id: string, input: ProposalInput, at: number) {
    parseId('proposal', id); input = proposalInput(input); return this.access(scope, true, tx => propose(tx, scope, id, input, at));
  }
  get(scope: TrustedScope, id: string) {
    parseId('proposal', id); return this.access(scope, false, tx => getProposal(tx, scope, id));
  }
  list(scope: TrustedScope, runId: string, limit: number) {
    parseId('run', runId); limit = recallLimit(limit);
    return this.access(scope, false, async tx => {
      const run = await tx.query(`SELECT id FROM viper_engine.runs WHERE ${LEARNING_OWNER} AND id = $4`, [...ownerColumns(scope), runId]);
      if (run.rows[0] === undefined) return stateConflict<never>({ code: 'not_found', message: 'Run not found' });
      const result = await tx.query(`${PROPOSAL_SELECT} WHERE ${LEARNING_OWNER} AND run_id = $4 ORDER BY created_at DESC, id LIMIT $5`, [...ownerColumns(scope), runId, limit + 1]);
      return stateOk(page(result.rows.map(proposalRow), limit));
    });
  }
  review(scope: TrustedScope, id: string, input: ProposalReview, noteId: string, at: number) {
    parseId('proposal', id); parseId('note', noteId); input = proposalReview(input);
    return this.access(scope, true, tx => review(tx, scope, id, input, noteId, at));
  }
  changes(scope: TrustedScope, id: string, limit: number) {
    parseId('proposal', id); limit = recallLimit(limit);
    return this.access(scope, false, async tx => {
      const current = await getProposal(tx, scope, id); if (!current.ok) return current;
      const result = await tx.query(`SELECT revision, status, note_id, ${msColumn('created_at')} FROM viper_engine.memory_proposal_changes
        WHERE ${LEARNING_OWNER} AND proposal_id = $4 ORDER BY revision DESC LIMIT $5`, [...ownerColumns(scope), id, limit + 1]);
      const items: ProposalChange[] = result.rows.map(value => { const row = asRow(value);
        return Object.freeze({ revision: integer(row, 'revision'), status: member(row, 'status', PROPOSAL_STATUSES), at: integer(row, 'created_at_ms'),
          ...(row['note_id'] === null ? {} : { noteId: text(row, 'note_id') }) }); });
      return stateOk(page(items, limit));
    });
  }
}
