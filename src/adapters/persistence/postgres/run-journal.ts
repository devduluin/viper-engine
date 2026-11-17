import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { RunJournal } from '../../../contracts/state/journal.js';
import type { RunCheckpoint } from '../../../contracts/state/checkpoints.js';
import type { StateResult } from '../../../contracts/state/result.js';
import type { StateConflict } from '../../../contracts/state/result.js';
import { stateConflict } from '../../../contracts/state/result.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { applyCommand, transactionPool } from './journal-commands.js';
import { leaseConflict, lockRun } from './run-lock.js';
import { asRow, integer, ownerColumns } from './rows.js';
import { PostgresCheckpointReader } from './checkpoint-reader.js';
import type { SqlPool } from './sql-client.js';
import { withTransaction } from './sql-client.js';

class CommitConflict extends Error {
  constructor(readonly conflict: StateConflict) { super(conflict.code); }
}

export class PostgresRunJournal implements RunJournal {
  constructor(private readonly pool: SqlPool) {}

  async commit(scope: TrustedScope, runId: RunId, input: Parameters<RunJournal['commit']>[2]): Promise<StateResult<RunCheckpoint>> {
    const state = parseJsonObject(input.state);
    try {
      return await withTransaction(this.pool, async tx => {
        const locked = await lockRun(tx, scope, runId);
        if (!locked.ok) return stateConflict<RunCheckpoint>(locked.error);
        const run = locked.value.record;
        const lost = leaseConflict(locked.value, input.lease, input.at);
        if (lost !== undefined) throw new CommitConflict(lost);
        if (isTerminalRunStatus(run.status)) throw new CommitConflict({ code: 'invalid_transition', message: 'Run is terminal' });
        await tx.query('SELECT id FROM viper_engine.conversations WHERE id = $1 FOR UPDATE', [run.conversationId]);
        const current = await tx.query('SELECT revision FROM viper_engine.runtime_checkpoints WHERE run_id = $1', [runId]);
        const revision = current.rows[0] === undefined ? 0 : integer(asRow(current.rows[0]), 'revision');
        if (revision !== input.expectedRevision) throw new CommitConflict({ code: 'revision_conflict', message: 'Execution checkpoint changed', currentRevision: revision });
        const pool = transactionPool(tx);
        for (const command of input.commands) {
          const result = await applyCommand({ pool, scope, runId, conversationId: run.conversationId, lease: input.lease, at: input.at }, command);
          if (!result.ok) throw new CommitConflict(result.error);
        }
        await tx.query(`INSERT INTO viper_engine.runtime_checkpoints (run_id, actor_id, app_id, tenant_key, revision, state)
          VALUES ($1, $2, $3, $4, 1, $5) ON CONFLICT (run_id) DO UPDATE SET revision = runtime_checkpoints.revision + 1, state = EXCLUDED.state`,
        [runId, ...ownerColumns(scope), state]);
        return new PostgresCheckpointReader(pool).load(scope, runId);
      });
    } catch (error) {
      if (error instanceof CommitConflict) return stateConflict(error.conflict);
      throw error;
    }
  }
}
