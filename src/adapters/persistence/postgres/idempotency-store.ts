import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseIdempotencyKey } from '../../../contracts/state/idempotency.js';
import type { IdempotencyBegin, IdempotencyKey, IdempotencyStore } from '../../../contracts/state/idempotency.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { NOT_FOUND } from './run-lock.js';
import { asRow, MS_PARAM, ownerColumns, text } from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { withTransaction } from './sql-client.js';

const MISMATCH = Object.freeze({ code: 'idempotency_conflict', message: 'Idempotency key was used with a different request' } as const);
const KEY = 'actor_id = $1 AND app_id = $2 AND tenant_key = $3 AND operation = $4 AND idempotency_key = $5';

function params(scope: TrustedScope, request: IdempotencyKey): unknown[] {
  return [...ownerColumns(scope), request.operation, request.key];
}

/** Serialize begin/complete/abandon, including deletion between a conflicting INSERT and SELECT. */
async function lockKey(tx: SqlQueryable, scope: TrustedScope, request: IdempotencyKey): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(params(scope, request))]);
}

function validateClaim(id: string): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid idempotency claim');
}

function decide(row: Readonly<Record<string, unknown>>, fingerprint: string): StateResult<IdempotencyBegin> {
  if (row['payload_fingerprint'] !== fingerprint) return stateConflict(MISMATCH);
  const ref = row['resource_ref'];
  return stateOk(typeof ref === 'string' ? { status: 'replay', resourceRef: ref } : { status: 'in_progress' });
}

/**
 * `request_idempotency`, keyed by owner + operation + key. The row lock serializes concurrent
 * first requests: exactly one gets `started`, the others see `in_progress` or `replay`.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: SqlPool) {}

  async begin(scope: TrustedScope, input: IdempotencyKey & { readonly at: number; readonly ttlMs: number }): Promise<StateResult<IdempotencyBegin>> {
    const request = parseIdempotencyKey(input);
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000) throw new RangeError('Invalid idempotency TTL');
    return withTransaction(this.pool, async tx => {
      await lockKey(tx, scope, request);
      const inserted = await tx.query(`INSERT INTO viper_engine.request_idempotency
          (actor_id, app_id, tenant_key, operation, idempotency_key, payload_fingerprint, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, ${MS_PARAM(7)}, ${MS_PARAM(7)} + $8::bigint * interval '1 millisecond')
        ON CONFLICT DO NOTHING RETURNING claim_id`, [...params(scope, request), request.fingerprint, input.at, input.ttlMs]);
      if (inserted.rowCount === 1) return stateOk({ status: 'started', claimId: text(asRow(inserted.rows[0]), 'claim_id') });
      return this.existing(tx, scope, request, input.at, input.ttlMs);
    });
  }

  async complete(scope: TrustedScope, input: IdempotencyKey & { readonly claimId: string; readonly resourceRef: string }): Promise<StateResult<{ readonly resourceRef: string }>> {
    const request = parseIdempotencyKey(input);
    validateClaim(input.claimId);
    if (input.resourceRef.length < 1 || input.resourceRef.length > 512) throw new Error('Invalid resource reference');
    return withTransaction(this.pool, async tx => {
      await lockKey(tx, scope, request);
      const current = await tx.query(`SELECT payload_fingerprint, resource_ref, claim_id FROM viper_engine.request_idempotency WHERE ${KEY} FOR UPDATE`, params(scope, request));
      const row = current.rows[0];
      if (row === undefined) return stateConflict(NOT_FOUND);
      if (asRow(row)['claim_id'] !== input.claimId) return stateConflict(MISMATCH);
      const state = decide(asRow(row), request.fingerprint);
      if (!state.ok) return stateConflict(state.error);
      if (state.value.status === 'replay') {
        return state.value.resourceRef === input.resourceRef ? stateOk({ resourceRef: input.resourceRef }) : stateConflict(MISMATCH);
      }
      await tx.query(`UPDATE viper_engine.request_idempotency SET resource_ref = $6 WHERE ${KEY}`, [...params(scope, request), input.resourceRef]);
      return stateOk({ resourceRef: input.resourceRef });
    });
  }

  async abandon(scope: TrustedScope, input: IdempotencyKey & { readonly claimId: string }): Promise<StateResult<{ readonly abandoned: boolean }>> {
    const request = parseIdempotencyKey(input);
    validateClaim(input.claimId);
    return withTransaction(this.pool, async tx => {
      await lockKey(tx, scope, request);
      const removed = await tx.query(`DELETE FROM viper_engine.request_idempotency
        WHERE ${KEY} AND payload_fingerprint = $6 AND claim_id = $7::uuid AND resource_ref IS NULL`,
      [...params(scope, request), request.fingerprint, input.claimId]);
      return stateOk({ abandoned: removed.rowCount === 1 });
    });
  }

  /** Existing key: an expired row starts over; otherwise same fingerprint replays or waits. */
  private async existing(tx: SqlQueryable, scope: TrustedScope, request: IdempotencyKey, at: number, ttlMs: number): Promise<StateResult<IdempotencyBegin>> {
    const current = await tx.query(`SELECT payload_fingerprint, resource_ref, expires_at <= ${MS_PARAM(6)} AS expired
      FROM viper_engine.request_idempotency WHERE ${KEY} FOR UPDATE`, [...params(scope, request), at]);
    const row = asRow(current.rows[0]);
    if (row['expired'] !== true) return decide(row, request.fingerprint);
    const replaced = await tx.query(`UPDATE viper_engine.request_idempotency SET payload_fingerprint = $6, resource_ref = NULL,
        claim_id = gen_random_uuid(), created_at = ${MS_PARAM(7)}, expires_at = ${MS_PARAM(7)} + $8::bigint * interval '1 millisecond'
        WHERE ${KEY} RETURNING claim_id`,
    [...params(scope, request), request.fingerprint, at, ttlMs]);
    return stateOk({ status: 'started', claimId: text(asRow(replaced.rows[0]), 'claim_id') });
  }
}
