import type { MessageId, RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import type { RunSteeringReader, SteeringMessage, SteeringSettleMode } from '../../../contracts/state/steering.js';
import { asRow, MS_PARAM, ownerColumns } from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';

const OWNER = 'actor_id = $2 AND app_id = $3 AND tenant_key = $4';

function steeringMessage(value: unknown): SteeringMessage {
  const message = parseMessage(asRow(value)['message']);
  if (message.role !== 'user') throw new Error('Invalid saved steering input');
  return message as SteeringMessage;
}

/** Pending inputs read by the run's lease holder; settling happens only inside its journal commit. */
export class PostgresRunSteering implements RunSteeringReader {
  constructor(private readonly pool: SqlPool) {}

  async pending(scope: TrustedScope, runId: RunId, limit: number): Promise<readonly SteeringMessage[]> {
    const result = await this.pool.query(`SELECT message FROM viper_engine.run_steering_inputs
      WHERE run_id = $1 AND ${OWNER} AND settled_at IS NULL ORDER BY seq LIMIT $5`, [runId, ...ownerColumns(scope), limit]);
    return Object.freeze(result.rows.map(steeringMessage));
  }
}

/** API side, under the run row lock taken by the caller's transaction. */
export async function queueSteering(tx: SqlQueryable, scope: TrustedScope, runId: RunId,
  input: { readonly inputId: string; readonly message: SteeringMessage; readonly at: number }): Promise<void> {
  await tx.query(`INSERT INTO viper_engine.run_steering_inputs (message_id, run_id, actor_id, app_id, tenant_key, input_id, message, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, ${MS_PARAM(8)})`,
  [input.message.id, runId, ...ownerColumns(scope), input.inputId, JSON.stringify(input.message), input.at]);
}

export async function pendingSteeringCount(tx: SqlQueryable, runId: RunId): Promise<number> {
  const result = await tx.query(`SELECT count(*)::int AS pending FROM viper_engine.run_steering_inputs
    WHERE run_id = $1 AND settled_at IS NULL`, [runId]);
  return Number(asRow(result.rows[0])['pending']);
}

/** Journal: every named input must still be pending for this run, or the whole commit rolls back. */
export async function consumeSteering(tx: SqlQueryable, runId: RunId, ids: readonly MessageId[], at: number): Promise<StateResult<number>> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return stateConflict({ code: 'invalid_transition', message: 'Steering consumption needs distinct inputs' });
  const result = await tx.query(`UPDATE viper_engine.run_steering_inputs SET settled_at = ${MS_PARAM(3)}, outcome = 'consumed'
    WHERE run_id = $1 AND message_id = ANY($2::text[]) AND settled_at IS NULL`, [runId, [...ids], at]);
  return result.rowCount === ids.length ? stateOk(ids.length)
    : stateConflict({ code: 'invalid_transition', message: 'Steering input is not pending for this run' });
}

/** Journal stop guard; runs under the run row lock, so no input can be queued between check and stop. */
export async function settleSteering(tx: SqlQueryable, runId: RunId, mode: SteeringSettleMode, at: number): Promise<StateResult<number>> {
  if (mode === 'require_none') {
    const pending = await pendingSteeringCount(tx, runId);
    return pending === 0 ? stateOk(0) : stateConflict({ code: 'steering_pending', message: 'A steering message is waiting for this run' });
  }
  const result = await tx.query(`UPDATE viper_engine.run_steering_inputs SET settled_at = ${MS_PARAM(2)}, outcome = 'discarded'
    WHERE run_id = $1 AND settled_at IS NULL`, [runId, at]);
  return stateOk(result.rowCount ?? 0);
}
