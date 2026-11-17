import type { EventReplayStore, ReplayPage } from '../../../contracts/events/replay.js';
import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { ApiFailure, requireState } from '../../../contracts/api/failure.js';
import { withSnapshot } from './sql-client.js';
import type { SqlPool } from './sql-client.js';
import { PostgresRunStore } from './run-store.js';
import { transactionPool } from './journal-commands.js';
import { asRow, integer } from './rows.js';
import { EVENT_COLUMNS, eventRecord } from './run-event-reader.js';
import { replayFacts } from './replay-facts.js';

export class PostgresEventReplay implements EventReplayStore {
  constructor(private readonly pool: SqlPool, private readonly retentionSeconds: number) {
    if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds < 1) throw new RangeError('Invalid event retention');
  }

  async read(scope: TrustedScope, runId: RunId, after: number | undefined, limit: number): Promise<ReplayPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new RangeError('Invalid replay batch');
    return withSnapshot(this.pool, async tx => {
      await tx.query("SET LOCAL statement_timeout = '5000ms'");
      const run = requireState(await new PostgresRunStore(transactionPool(tx)).get(scope, runId));
      const high = await tx.query('SELECT last_event_sequence FROM viper_engine.runs WHERE id = $1', [runId]);
      const lastEventSequence = integer(asRow(high.rows[0]), 'last_event_sequence');
      if (after === undefined) return { run, lastEventSequence, items: [] };
      if (!Number.isSafeInteger(after) || after < 0 || after > lastEventSequence) throw new ApiFailure('INVALID_CURSOR');
      const result = await tx.query(`SELECT ${EVENT_COLUMNS} FROM viper_engine.run_events
        WHERE run_id = $1 AND sequence > $2 AND occurred_at >= clock_timestamp() - $3::bigint * interval '1 second'
        ORDER BY sequence LIMIT $4`, [runId, after, this.retentionSeconds, limit]);
      const events = result.rows.map(eventRecord);
      if (after < lastEventSequence && events.length === 0) throw unavailable(runId);
      for (const [index, event] of events.entries()) if (event.sequence !== after + index + 1) throw unavailable(runId);
      return { run, lastEventSequence, items: await replayFacts(tx, runId, events) };
    });
  }
}

function unavailable(runId: RunId): ApiFailure {
  return new ApiFailure('EVENT_CURSOR_EXPIRED', { runId, action: 'fetch_snapshot' });
}
