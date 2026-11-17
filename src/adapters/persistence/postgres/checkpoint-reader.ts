import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { CheckpointReader, RunCheckpoint } from '../../../contracts/state/checkpoints.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { MESSAGE_COLUMNS, storedMessage } from './message-rows.js';
import { NOT_FOUND } from './run-lock.js';
import {
  APPROVAL_COLUMNS, approvalRecord, asRow, integer, RUN_COLUMNS, runRecord, TOOL_CALL_COLUMNS, toolCallRecord,
} from './rows.js';
import type { SqlPool } from './sql-client.js';
import { withSnapshot } from './sql-client.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import { runUsage } from './run-usage.js';

const DEFAULT_MAX_MESSAGES = 10_000;

/**
 * Resume snapshot in one REPEATABLE READ transaction: run state, full conversation history,
 * the run's tool-call ledger and approvals, and the event cursor all reflect the same instant.
 * A run is resumed from this, never from a client-supplied history.
 */
export class PostgresCheckpointReader implements CheckpointReader {
  constructor(private readonly pool: SqlPool) {}

  async load(scope: TrustedScope, runId: RunId, options: { readonly maxMessages?: number } = {}): Promise<StateResult<RunCheckpoint>> {
    const max = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    if (!Number.isSafeInteger(max) || max < 1 || max > 100000) throw new RangeError('Invalid message limit');
    return withSnapshot(this.pool, async tx => {
      const runRow = await tx.query(`SELECT ${RUN_COLUMNS} FROM viper_engine.runs WHERE id = $1`, [runId]);
      if (runRow.rows[0] === undefined) return stateConflict<RunCheckpoint>(NOT_FOUND);
      const run = runRecord(runRow.rows[0]);
      if (checkOwnership(run.owner, scope) !== undefined) return stateConflict<RunCheckpoint>(NOT_FOUND);
      const conversation = await tx.query('SELECT revision, next_message_position FROM viper_engine.conversations WHERE id = $1', [run.conversationId]);
      const counts = asRow(conversation.rows[0]);
      if (integer(counts, 'next_message_position') > max) throw new RangeError(`History exceeds ${max} messages; compact before resuming`);
      // One SQL connection: sequential queries retain the snapshot without pg's deprecated query queue.
      const messages = await tx.query(`SELECT ${MESSAGE_COLUMNS} FROM viper_engine.messages WHERE conversation_id = $1 ORDER BY position`, [run.conversationId]);
      const calls = await tx.query(`SELECT ${TOOL_CALL_COLUMNS} FROM viper_engine.tool_calls WHERE run_id = $1 ORDER BY created_at, id LIMIT $2`, [runId, max + 1]);
      const approvals = await tx.query(`SELECT ${APPROVAL_COLUMNS} FROM viper_engine.approvals WHERE run_id = $1 ORDER BY created_at, id LIMIT $2`, [runId, max + 1]);
      if (calls.rows.length > max || approvals.rows.length > max) throw new RangeError('Checkpoint ledger exceeds bounded record limit');
      const execution = await tx.query('SELECT revision, state FROM viper_engine.runtime_checkpoints WHERE run_id = $1', [runId]);
      const saved = execution.rows[0] === undefined ? undefined : asRow(execution.rows[0]);
      const stored = messages.rows.map(storedMessage);
      return stateOk(Object.freeze({
        run, usage: await runUsage(tx, runId), conversationRevision: integer(counts, 'revision'),
        history: Object.freeze(stored.map(row => row.message)),
        runMessageIds: Object.freeze(stored.filter(row => row.runId === runId).map(row => row.message.id)),
        toolCalls: Object.freeze(calls.rows.map(toolCallRecord)),
        approvals: Object.freeze(approvals.rows.map(approvalRecord)),
        lastEventSequence: integer(asRow(runRow.rows[0]), 'last_event_sequence'),
        ...(saved === undefined ? {} : { execution: Object.freeze({ revision: integer(saved, 'revision'), state: parseJsonObject(saved['state']) }) }),
      }));
    });
  }
}
