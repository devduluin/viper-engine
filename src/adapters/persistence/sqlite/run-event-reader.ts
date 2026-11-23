import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { RunEventRecord } from '../../../contracts/state/events.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { RunEventReader } from '../../../contracts/state/ports.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { MAX_EVENT_PAGE, eventRecord } from '../postgres/run-event-reader.js';
import { NOT_FOUND } from '../postgres/run-lock.js';
import { asRow, runRecord, text } from '../postgres/rows.js';
import type { SqlitePool } from './pool.js';

export function decodeEvent(value: unknown): RunEventRecord {
  const row = asRow(value);
  return eventRecord({ ...row, payload: JSON.parse(text(row, 'payload')) });
}

export class SqliteRunEventReader implements RunEventReader {
  constructor(private readonly pool: SqlitePool) {}

  async readAfter(scope: TrustedScope, runId: RunId, afterSequence: number, limit: number): Promise<StateResult<readonly RunEventRecord[]>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new RangeError('Invalid event cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) throw new RangeError('Invalid event page size');
    return this.pool.transaction(async tx => {
      const run = (await tx.query('SELECT * FROM viper_engine.runs WHERE id = ?', [runId])).rows[0];
      if (run === undefined || checkOwnership(runRecord(run).owner, scope) !== undefined) return stateConflict(NOT_FOUND);
      const result = await tx.query(`SELECT * FROM viper_engine.run_events
        WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`, [runId, afterSequence, limit]);
      return stateOk(Object.freeze(result.rows.map(decodeEvent)));
    });
  }
}
