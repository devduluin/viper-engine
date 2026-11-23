import type { MessageId, RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import type { RunSteeringReader, SteeringMessage, SteeringSettleMode } from '../../../contracts/state/steering.js';
import { asRow, integer, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';

export class SqliteRunSteering implements RunSteeringReader {
  constructor(private readonly db: SqlQueryable) {}

  async pending(scope: TrustedScope, runId: RunId, limit: number): Promise<readonly SteeringMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid steering limit');
    const result = await this.db.query(`SELECT message FROM viper_engine.run_steering_inputs
      WHERE run_id = ? AND actor_id = ? AND app_id = ? AND tenant_key = ? AND settled_at_ms IS NULL ORDER BY seq LIMIT ?`,
    [runId, ...ownerColumns(scope), limit]);
    return Object.freeze(result.rows.map(row => {
      const message = parseMessage(JSON.parse(text(asRow(row), 'message')));
      if (message.role !== 'user') throw new Error('Invalid saved steering input');
      return message as SteeringMessage;
    }));
  }
}

export async function queueSteering(tx: SqlQueryable, scope: TrustedScope, runId: RunId,
  input: { readonly inputId: string; readonly message: SteeringMessage; readonly at: number }): Promise<void> {
  await tx.query(`INSERT INTO viper_engine.run_steering_inputs (message_id, run_id, actor_id, app_id, tenant_key, input_id, message, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [input.message.id, runId, ...ownerColumns(scope), input.inputId, JSON.stringify(input.message), input.at]);
}

export async function consumeSteering(tx: SqlQueryable, runId: RunId, ids: readonly MessageId[], at: number): Promise<StateResult<number>> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return stateConflict({ code: 'invalid_transition', message: 'Steering consumption needs distinct inputs' });
  const result = await tx.query(`UPDATE viper_engine.run_steering_inputs SET settled_at_ms = ?, outcome = 'consumed'
    WHERE run_id = ? AND message_id IN (SELECT value FROM json_each(?)) AND settled_at_ms IS NULL`, [at, runId, JSON.stringify(ids)]);
  return result.rowCount === ids.length ? stateOk(ids.length)
    : stateConflict({ code: 'invalid_transition', message: 'Steering input is not pending for this run' });
}

export async function settleSteering(tx: SqlQueryable, runId: RunId, mode: SteeringSettleMode, at: number): Promise<StateResult<number>> {
  if (mode === 'require_none') {
    return await pendingSteeringCount(tx, runId) === 0 ? stateOk(0)
      : stateConflict({ code: 'steering_pending', message: 'A steering message is waiting for this run' });
  }
  const result = await tx.query(`UPDATE viper_engine.run_steering_inputs SET settled_at_ms = ?, outcome = 'discarded'
    WHERE run_id = ? AND settled_at_ms IS NULL`, [at, runId]);
  return stateOk(result.rowCount ?? 0);
}

export async function pendingSteeringCount(tx: SqlQueryable, runId: RunId): Promise<number> {
  const result = await tx.query('SELECT count(*) AS pending FROM viper_engine.run_steering_inputs WHERE run_id = ? AND settled_at_ms IS NULL', [runId]);
  return integer(asRow(result.rows[0]), 'pending');
}
