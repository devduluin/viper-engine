import type { RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import { checkNextEventSequence } from '../../../contracts/state/events.js';
import { checkLease } from '../../../contracts/state/leases.js';
import type { LeaseState, LeaseToken } from '../../../contracts/state/leases.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { RunRecord } from '../../../contracts/state/records.js';
import type { StateConflict } from '../../../contracts/state/result.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { asRow, integer, MS_PARAM, ownerColumns, RUN_COLUMNS, runRecord } from './rows.js';
import type { SqlQueryable } from './sql-client.js';

export interface LockedRun {
  readonly record: RunRecord;
  readonly lastEventSequence: number;
  readonly lease: LeaseState;
  /** Database wall time sampled after the row lock is acquired, not the event's timestamp. */
  readonly leaseCheckedAt?: number;
}

export function leaseStateOf(value: unknown): LeaseState {
  const row = asRow(value);
  const owner = row['lease_owner'];
  return Object.freeze({
    fence: integer(row, 'lease_fence'),
    ...(typeof owner === 'string' ? { owner } : {}),
    ...(row['lease_expires_at_ms'] === null ? {} : { expiresAt: integer(row, 'lease_expires_at_ms') }),
  });
}

/** Durable-driver writes carry a lease; checked under the run row lock, before any write. */
export function leaseConflict(run: LockedRun, lease: LeaseToken | undefined, at: number): StateConflict | undefined {
  if (lease !== undefined) return checkLease(run.lease, lease, Math.max(at, run.leaseCheckedAt ?? at));
  return run.lease.fence === 0 && run.lease.owner === undefined ? undefined
    : { code: 'lease_lost', message: 'A previously claimed run requires a current lease' };
}

const NOT_FOUND = Object.freeze({ code: 'not_found', message: 'Record not found' } as const);

/**
 * Every write that appends events locks its run row first. That one lock order
 * (run -> tool call -> approval) serializes sequence allocation and avoids deadlocks.
 */
export async function lockRun(tx: SqlQueryable, scope: TrustedScope, runId: RunId, mode: 'UPDATE' | 'SHARE' = 'UPDATE'): Promise<StateResult<LockedRun>> {
  const result = await tx.query(`SELECT ${RUN_COLUMNS} FROM viper_engine.runs WHERE id = $1 FOR ${mode}`, [runId]);
  const row = result.rows[0];
  if (row === undefined) return stateConflict(NOT_FOUND);
  const record = runRecord(row);
  const failure = checkOwnership(record.owner, scope);
  if (failure !== undefined) return stateConflict(failure);
  const time = await tx.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS checked_at');
  return stateOk({ record, lastEventSequence: integer(asRow(row), 'last_event_sequence'), lease: leaseStateOf(row),
    leaseCheckedAt: integer(asRow(time.rows[0]), 'checked_at') });
}

/**
 * Admission rule for new tool work (proposal, dispatch, approval consumption): a terminal run or
 * one with durable cancellation intent accepts none. Recording outcomes of already dispatched
 * calls stays allowed, so reconciliation still works after cancellation.
 */
export function admissionConflict(run: RunRecord): StateConflict | undefined {
  if (isTerminalRunStatus(run.status)) return { code: 'invalid_transition', message: 'Run is terminal; no new tool work' };
  if (run.cancelRequestedAt !== undefined) return { code: 'invalid_transition', message: 'Run cancellation requested; no new tool work' };
  return undefined;
}

/** Appends events after the locked run's last sequence, in the caller's transaction. */
export async function appendEvents(
  tx: SqlQueryable, scope: TrustedScope, run: LockedRun, events: readonly NewRunEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const [actorId, appId, tenantKey] = ownerColumns(scope);
  let sequence = run.lastEventSequence;
  for (const event of events) {
    const conflict = checkNextEventSequence(sequence, sequence + 1);
    if (conflict !== undefined) throw new RangeError(conflict.message);
    sequence += 1;
    await tx.query(`INSERT INTO viper_engine.run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key,
        conversation_id, type, step_id, model_call_id, tool_call_id, occurred_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${MS_PARAM(12)}, $13)`, [
      run.record.id, sequence, event.eventId, actorId, appId, tenantKey, run.record.conversationId, event.type,
      event.stepId ?? null, event.modelCallId ?? null, event.toolCallId ?? null, event.occurredAt, event.payload,
    ]);
  }
  await tx.query('UPDATE viper_engine.runs SET last_event_sequence = $2 WHERE id = $1', [run.record.id, sequence]);
}

export { NOT_FOUND };
