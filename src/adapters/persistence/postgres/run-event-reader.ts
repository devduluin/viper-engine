import { parseId } from '../../../contracts/identity/ids.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { RunEventRecord } from '../../../contracts/state/events.js';
import { RUN_EVENT_TYPES } from '../../../contracts/state/events.js';
import type { RunEventReader } from '../../../contracts/state/ports.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { lockRun } from './run-lock.js';
import { asRow, integer, member, msColumn } from './rows.js';
import type { SqlPool } from './sql-client.js';
import { withTransaction } from './sql-client.js';

export const MAX_EVENT_PAGE = 500;

export const EVENT_COLUMNS = ['run_id', 'conversation_id', 'sequence', 'event_id', 'type', 'step_id', 'model_call_id',
  'tool_call_id', msColumn('occurred_at'), 'payload'].join(', ');

function optionalId<Kind extends string>(kind: Kind, value: unknown) {
  return value === null || value === undefined ? undefined : parseId(kind, value);
}

export function eventRecord(value: unknown): RunEventRecord {
  const row = asRow(value);
  const stepId = optionalId('step', row['step_id']);
  const modelCallId = optionalId('model_call', row['model_call_id']);
  const toolCallId = optionalId('tool_call', row['tool_call_id']);
  return Object.freeze({
    runId: parseId('run', row['run_id']), conversationId: parseId('conversation', row['conversation_id']),
    sequence: integer(row, 'sequence'), eventId: parseId('run_event', row['event_id']),
    type: member(row, 'type', RUN_EVENT_TYPES), occurredAt: integer(row, 'occurred_at_ms'),
    payload: parseJsonObject(row['payload']),
    ...(stepId === undefined ? {} : { stepId }),
    ...(modelCallId === undefined ? {} : { modelCallId }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
  });
}

export class PostgresRunEventReader implements RunEventReader {
  constructor(private readonly pool: SqlPool) {}

  /** Cursor read: sequence > afterSequence, ascending. Ownership is checked on the run first. */
  async readAfter(scope: TrustedScope, runId: RunId, afterSequence: number, limit: number): Promise<StateResult<readonly RunEventRecord[]>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new RangeError('Invalid event cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) throw new RangeError('Invalid event page size');
    return withTransaction(this.pool, async tx => {
      const run = await lockRun(tx, scope, runId, 'SHARE');
      if (!run.ok) return stateConflict(run.error);
      const result = await tx.query(`SELECT ${EVENT_COLUMNS} FROM viper_engine.run_events
        WHERE run_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3`, [runId, afterSequence, limit]);
      return stateOk(Object.freeze(result.rows.map(eventRecord)));
    });
  }
}
