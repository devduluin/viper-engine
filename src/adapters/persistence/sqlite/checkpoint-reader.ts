import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { CheckpointReader, RunCheckpoint } from '../../../contracts/state/checkpoints.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { checkpointHistoryStart, historyBubbleLimit } from '../postgres/checkpoint-reader.js';
import { asRow, integer, text } from '../postgres/rows.js';
import { decodeRunUsage } from '../postgres/run-usage.js';
import { withSnapshot } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { decodeApproval } from './approval-rows.js';
import { decodeMessage } from './message-store.js';
import { lockRun } from './run-store.js';
import { callRecord } from './tool-call-rows.js';

async function usage(tx: SqlQueryable, runId: RunId) {
  const result = await tx.query(`SELECT count(*) AS calls, count(DISTINCT usage_source) AS sources, min(usage_source) AS single_source,
    count(input_tokens) AS input_count, sum(input_tokens) AS input_sum,
    count(output_tokens) AS output_count, sum(output_tokens) AS output_sum,
    count(total_tokens) AS total_count, sum(total_tokens) AS total_sum FROM viper_engine.model_calls WHERE run_id = ?`, [runId]);
  return decodeRunUsage(result.rows[0]);
}

function executionState(row: unknown) {
  if (row === undefined) return undefined;
  const saved = asRow(row);
  return { revision: integer(saved, 'revision'), state: parseJsonObject(JSON.parse(text(saved, 'state'))) };
}

export class SqliteCheckpointReader implements CheckpointReader {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now, private readonly historyLimit?: number) {}

  async load(scope: TrustedScope, runId: RunId, options: { readonly maxMessages?: number } = {}): Promise<StateResult<RunCheckpoint>> {
    const max = options.maxMessages ?? 10_000;
    if (!Number.isSafeInteger(max) || max < 1 || max > 100_000) throw new RangeError('Invalid message limit');
    return withSnapshot(this.pool, async tx => {
      const scoped = await lockRun(tx, scope, runId, this.clock);
      if (!scoped.ok) return stateConflict<RunCheckpoint>(scoped.error);
      const { record: run, lastEventSequence } = scoped.value;
      const conversation = await tx.query('SELECT revision, next_message_position FROM viper_engine.conversations WHERE id = ?', [run.conversationId]);
      const counts = asRow(conversation.rows[0]);
      const limit = this.historyLimit ?? historyBubbleLimit();
      if (integer(counts, 'next_message_position') > (limit > 0 ? 100_000 : max)) {
        throw new RangeError(`History exceeds ${max} messages; compact before resuming`);
      }
      const execution = (await tx.query('SELECT revision, state FROM viper_engine.runtime_checkpoints WHERE run_id = ?', [runId])).rows[0];
      const saved = executionState(execution);
      const cutoff = await checkpointHistoryStart(tx, run.conversationId, runId, limit, saved?.state);
      const messages = await tx.query('SELECT * FROM viper_engine.messages WHERE conversation_id = $1 AND position >= $2 ORDER BY position', [run.conversationId, cutoff]);
      const calls = await tx.query('SELECT * FROM viper_engine.tool_calls WHERE run_id = ? ORDER BY created_at_ms, id LIMIT ?', [runId, max + 1]);
      const approvals = await tx.query('SELECT * FROM viper_engine.approvals WHERE run_id = ? ORDER BY created_at_ms, id LIMIT ?', [runId, max + 1]);
      if (calls.rows.length > max || approvals.rows.length > max) throw new RangeError('Checkpoint ledger exceeds bounded record limit');
      const stored = messages.rows.map(decodeMessage);
      return stateOk(Object.freeze({
        run, usage: await usage(tx, runId), conversationRevision: integer(counts, 'revision'), lastEventSequence,
        history: Object.freeze(stored.map(row => row.message)),
        runMessageIds: Object.freeze(stored.filter(row => row.runId === runId).map(row => row.message.id)),
        toolCalls: Object.freeze(calls.rows.map(callRecord)), approvals: Object.freeze(approvals.rows.map(decodeApproval)),
        ...(saved === undefined ? {} : { execution: Object.freeze(saved) }),
      }));
    });
  }
}
