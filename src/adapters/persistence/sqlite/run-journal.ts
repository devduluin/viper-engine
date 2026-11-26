import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { RunCheckpoint } from '../../../contracts/state/checkpoints.js';
import type { RunJournal } from '../../../contracts/state/journal.js';
import { stateConflict } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { transactionPool } from '../postgres/journal-commands.js';
import { leaseConflict } from '../postgres/run-lock.js';
import { asRow, integer, ownerColumns } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool } from '../postgres/sql-client.js';
import { SqliteCheckpointReader } from './checkpoint-reader.js';
import { applyCommand } from './journal-commands.js';
import { lockRun } from './run-store.js';

class JournalConflict extends Error {
  constructor(readonly conflict: StateConflict) { super(conflict.code); }
}

export class SqliteRunJournal implements RunJournal {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now, private readonly historyLimit?: number) {}

  async commit(scope: TrustedScope, runId: RunId, input: Parameters<RunJournal['commit']>[2]): Promise<StateResult<RunCheckpoint>> {
    const state = JSON.stringify(parseJsonObject(input.state));
    try {
      return await withTransaction(this.pool, async tx => {
        const locked = await lockRun(tx, scope, runId, this.clock);
        if (!locked.ok) return stateConflict<RunCheckpoint>(locked.error);
        const run = locked.value.record;
        const lost = leaseConflict(locked.value, input.lease, input.at);
        if (lost !== undefined) throw new JournalConflict(lost);
        if (isTerminalRunStatus(run.status)) throw new JournalConflict({ code: 'invalid_transition', message: 'Run is terminal' });
        const current = (await tx.query('SELECT revision FROM viper_engine.runtime_checkpoints WHERE run_id = ?', [runId])).rows[0];
        const revision = current === undefined ? 0 : integer(asRow(current), 'revision');
        if (revision !== input.expectedRevision) throw new JournalConflict({
          code: 'revision_conflict', message: 'Execution checkpoint changed', currentRevision: revision,
        });
        const pool = transactionPool(tx);
        const context = { pool, scope, runId, conversationId: run.conversationId, lease: input.lease, at: input.at, clock: this.clock };
        for (const command of input.commands) {
          const result = await applyCommand(context, command);
          if (!result.ok) throw new JournalConflict(result.error);
        }
        await tx.query(`INSERT INTO viper_engine.runtime_checkpoints (run_id, actor_id, app_id, tenant_key, revision, state)
          VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (run_id) DO UPDATE SET
          revision = runtime_checkpoints.revision + 1, state = excluded.state`, [runId, ...ownerColumns(scope), state]);
        const checkpoint = await new SqliteCheckpointReader(pool, this.clock, this.historyLimit).load(scope, runId);
        if (!checkpoint.ok) throw new JournalConflict(checkpoint.error);
        return checkpoint;
      });
    } catch (error) {
      if (error instanceof JournalConflict) return stateConflict(error.conflict);
      throw error;
    }
  }
}
