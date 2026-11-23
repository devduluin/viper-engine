import { randomUUID } from 'node:crypto';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseIdempotencyKey } from '../../../contracts/state/idempotency.js';
import type { IdempotencyBegin, IdempotencyKey, IdempotencyStore } from '../../../contracts/state/idempotency.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { NOT_FOUND } from '../postgres/run-lock.js';
import { asRow, integer, ownerColumns } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';

const MISMATCH = { code: 'idempotency_conflict', message: 'Idempotency key was used with a different request' } as const;
const KEY = 'actor_id = ? AND app_id = ? AND tenant_key = ? AND operation = ? AND idempotency_key = ?';
const params = (scope: TrustedScope, key: IdempotencyKey) => [...ownerColumns(scope), key.operation, key.key];

function validateClaim(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid idempotency claim');
}

async function existing(tx: SqlQueryable, key: string[]) {
  const row = (await tx.query(`SELECT * FROM viper_engine.request_idempotency WHERE ${KEY}`, key)).rows[0];
  return row === undefined ? undefined : asRow(row);
}

export class SqliteIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: SqlPool) {}

  async begin(scope: TrustedScope, input: Parameters<IdempotencyStore['begin']>[1]): Promise<StateResult<IdempotencyBegin>> {
    const request = parseIdempotencyKey(input);
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1000 || !Number.isSafeInteger(input.at + input.ttlMs)) {
      throw new RangeError('Invalid idempotency TTL');
    }
    return withTransaction(this.pool, async tx => {
      const key = params(scope, request);
      const current = await existing(tx, key);
      if (current !== undefined && integer(current, 'expires_at_ms') > input.at) {
        if (current['payload_fingerprint'] !== request.fingerprint) return stateConflict(MISMATCH);
        const ref = current['resource_ref'];
        return stateOk(typeof ref === 'string' ? { status: 'replay', resourceRef: ref } : { status: 'in_progress' });
      }
      const claimId = randomUUID();
      await tx.query(`INSERT INTO viper_engine.request_idempotency (actor_id, app_id, tenant_key, operation, idempotency_key,
        payload_fingerprint, claim_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (actor_id, app_id, tenant_key, operation, idempotency_key) DO UPDATE SET
        payload_fingerprint = excluded.payload_fingerprint, claim_id = excluded.claim_id, resource_ref = NULL,
        created_at_ms = excluded.created_at_ms, expires_at_ms = excluded.expires_at_ms`,
      [...key, request.fingerprint, claimId, input.at, input.at + input.ttlMs]);
      return stateOk({ status: 'started', claimId });
    });
  }

  async complete(scope: TrustedScope, input: Parameters<IdempotencyStore['complete']>[1]): ReturnType<IdempotencyStore['complete']> {
    const key = params(scope, parseIdempotencyKey(input));
    validateClaim(input.claimId);
    if (input.resourceRef.length < 1 || input.resourceRef.length > 512) throw new Error('Invalid resource reference');
    return withTransaction(this.pool, async tx => {
      const row = await existing(tx, key);
      if (row === undefined) return stateConflict(NOT_FOUND);
      if (row['claim_id'] !== input.claimId || row['payload_fingerprint'] !== input.fingerprint) return stateConflict(MISMATCH);
      const ref = row['resource_ref'];
      if (typeof ref === 'string' && ref !== input.resourceRef) return stateConflict(MISMATCH);
      if (ref === null) {
        await tx.query(`UPDATE viper_engine.request_idempotency SET resource_ref = ? WHERE ${KEY}`, [input.resourceRef, ...key]);
      }
      return stateOk({ resourceRef: input.resourceRef });
    });
  }

  async abandon(scope: TrustedScope, input: Parameters<IdempotencyStore['abandon']>[1]): ReturnType<IdempotencyStore['abandon']> {
    const key = params(scope, parseIdempotencyKey(input));
    validateClaim(input.claimId);
    const result = await this.pool.query(`DELETE FROM viper_engine.request_idempotency
      WHERE ${KEY} AND payload_fingerprint = ? AND claim_id = ? AND resource_ref IS NULL`, [...key, input.fingerprint, input.claimId]);
    return stateOk({ abandoned: result.rowCount === 1 });
  }
}
