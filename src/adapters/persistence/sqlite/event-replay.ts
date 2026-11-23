import { ApiFailure, requireState } from '../../../contracts/api/failure.js';
import type { EventReplayStore, ReplayPage } from '../../../contracts/events/replay.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { assembleReplayItems } from '../postgres/replay-facts.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { decodeApproval } from './approval-rows.js';
import { decodeMessage } from './message-store.js';
import type { SqlitePool } from './pool.js';
import { decodeEvent } from './run-event-reader.js';
import { lockRun } from './run-store.js';
import { callRecord } from './tool-call-rows.js';

async function facts<T>(tx: SqlQueryable, table: 'messages' | 'approvals' | 'tool_calls', runId: RunId,
  ids: readonly string[], decode: (row: unknown) => T): Promise<readonly T[]> {
  if (ids.length === 0) return [];
  const result = await tx.query(`SELECT * FROM viper_engine.${table}
    WHERE run_id = ? AND id IN (SELECT value FROM json_each(?))`, [runId, JSON.stringify(ids)]);
  return result.rows.map(decode);
}

function cutoff(now: number, retentionSeconds: number) {
  return now - retentionSeconds * 1000;
}

export class SqliteEventReplay implements EventReplayStore {
  constructor(private readonly pool: SqlitePool, private readonly retentionSeconds: number, private readonly clock: () => number = Date.now) {
    if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds < 1 || !Number.isSafeInteger(retentionSeconds * 1000)) {
      throw new RangeError('Invalid event retention');
    }
  }

  async read(scope: TrustedScope, runId: RunId, after: number | undefined, limit: number): Promise<ReplayPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new RangeError('Invalid replay batch');
    return this.pool.snapshot(async tx => {
      const { record: run, lastEventSequence } = requireState(await lockRun(tx, scope, runId, this.clock));
      if (after === undefined) return { run, lastEventSequence, items: [] };
      if (!Number.isSafeInteger(after) || after < 0 || after > lastEventSequence) throw new ApiFailure('INVALID_CURSOR');
      const result = await tx.query(`SELECT * FROM viper_engine.run_events
        WHERE run_id = ? AND sequence > ? AND occurred_at_ms >= ? ORDER BY sequence LIMIT ?`,
      [runId, after, cutoff(this.clock(), this.retentionSeconds), limit]);
      const events = result.rows.map(decodeEvent);
      if ((after < lastEventSequence && events.length === 0) || events.some((event, index) => event.sequence !== after + index + 1)) {
        throw new ApiFailure('EVENT_CURSOR_EXPIRED', { runId, action: 'fetch_snapshot' });
      }
      const messages = await facts(tx, 'messages', runId, events.flatMap(event =>
        typeof event.payload['messageId'] === 'string' ? [event.payload['messageId']] : []), decodeMessage);
      const approvals = await facts(tx, 'approvals', runId, events.flatMap(event =>
        typeof event.payload['approvalId'] === 'string' ? [event.payload['approvalId']] : []), decodeApproval);
      const tools = await facts(tx, 'tool_calls', runId, events.flatMap(event =>
        event.toolCallId === undefined ? [] : [event.toolCallId]), callRecord);
      return { run, lastEventSequence, items: assembleReplayItems(events, messages, approvals, tools) };
    });
  }
}
