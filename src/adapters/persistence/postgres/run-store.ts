import { WAKEABLE_RUN_STATUSES as WAKEABLE } from '../../../contracts/state/run-state.js';
import type { RunEffort } from '../../../contracts/state/ports.js';
import type { ConversationId, RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import type { LeaseToken } from '../../../contracts/state/leases.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { ConversationStore, RunStore } from '../../../contracts/state/ports.js';
import type { ConversationRecord, RunRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { applyRunTransition, requestRunCancellation } from '../../../contracts/state/transitions.js';
import type { RunTransitionRequest } from '../../../contracts/state/transitions.js';
import { TOOL_CALL_STATUSES } from '../../../contracts/state/tool-call-state.js';
import { appendEvents, leaseConflict, lockRun, NOT_FOUND } from './run-lock.js';
import type { LockedRun } from './run-lock.js';
import {
  asRow, CONVERSATION_COLUMNS, conversationRecord, member, MS_PARAM, ownerColumns, RUN_COLUMNS, runRecord,
} from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { withTransaction } from './sql-client.js';

function owned<R extends { readonly owner: RunRecord['owner'] }>(record: R | undefined, scope: TrustedScope): StateResult<R> {
  if (record === undefined) return stateConflict(NOT_FOUND);
  const failure = checkOwnership(record.owner, scope);
  return failure === undefined ? stateOk(record) : stateConflict(failure);
}

export class PostgresConversationStore implements ConversationStore {
  constructor(private readonly pool: SqlPool) {}

  async create(scope: TrustedScope, input: { readonly id: ConversationId; readonly title?: string; readonly at: number }) {
    const result = await this.pool.query(`INSERT INTO viper_engine.conversations
        (id, actor_id, app_id, tenant_key, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, ${MS_PARAM(6)}, ${MS_PARAM(6)}) RETURNING ${CONVERSATION_COLUMNS}`,
    [input.id, ...ownerColumns(scope), input.title ?? null, input.at]);
    return stateOk(conversationRecord(result.rows[0]));
  }

  async get(scope: TrustedScope, id: ConversationId): Promise<StateResult<ConversationRecord>> {
    const result = await this.pool.query(`SELECT ${CONVERSATION_COLUMNS} FROM viper_engine.conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const row = result.rows[0];
    return owned(row === undefined ? undefined : conversationRecord(row), scope);
  }
}

type TransitionInput = Omit<RunTransitionRequest, 'toolCalls'> & { readonly events: readonly NewRunEvent[]; readonly lease?: LeaseToken };

function revisionEvents(events: readonly NewRunEvent[], record: RunRecord): readonly NewRunEvent[] {
  return events.map(event => event.type.startsWith('run.') ? { ...event, payload: { ...event.payload, revision: record.revision } } : event);
}

async function writeRun(tx: SqlQueryable, before: RunRecord, after: RunRecord): Promise<void> {
  const result = await tx.query(`UPDATE viper_engine.runs SET status = $3, revision = $4,
      cancel_requested_at = ${MS_PARAM(5)}, updated_at = ${MS_PARAM(6)}
    WHERE id = $1 AND revision = $2`,
  [after.id, before.revision, after.status, after.revision, after.cancelRequestedAt ?? null, after.updatedAt]);
  if (result.rowCount !== 1) throw new Error('Run row changed while locked');
}

export class PostgresRunStore implements RunStore {
  constructor(private readonly pool: SqlPool) {}

  async create(scope: TrustedScope, input: {
    readonly id: RunId; readonly conversationId: ConversationId; readonly at: number; readonly events: readonly NewRunEvent[];
    readonly effort?: RunEffort; readonly clientTools?: readonly string[];
  }): Promise<StateResult<RunRecord>> {
    return withTransaction(this.pool, async tx => {
      const parent = await tx.query(`SELECT ${CONVERSATION_COLUMNS} FROM viper_engine.conversations WHERE id = $1 AND deleted_at IS NULL FOR SHARE`,
        [input.conversationId]);
      const conversation = owned(parent.rows[0] === undefined ? undefined : conversationRecord(parent.rows[0]), scope);
      if (!conversation.ok) return stateConflict(conversation.error);
      const inserted = await tx.query(`INSERT INTO viper_engine.runs
          (id, actor_id, app_id, tenant_key, conversation_id, status, created_at, updated_at, effort, client_tools)
        VALUES ($1, $2, $3, $4, $5, 'queued', ${MS_PARAM(6)}, ${MS_PARAM(6)}, $7, $8) RETURNING ${RUN_COLUMNS}`,
      [input.id, ...ownerColumns(scope), input.conversationId, input.at, input.effort ?? null,
        input.clientTools !== undefined && input.clientTools.length > 0 ? [...input.clientTools] : null]);
      const record = runRecord(inserted.rows[0]);
      await appendEvents(tx, scope, { record, lastEventSequence: 0, lease: { fence: 0 } }, revisionEvents(input.events, record));
      return stateOk(record);
    });
  }

  async get(scope: TrustedScope, id: RunId): Promise<StateResult<RunRecord>> {
    const result = await this.pool.query(`SELECT ${RUN_COLUMNS} FROM viper_engine.runs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return owned(row === undefined ? undefined : runRecord(row), scope);
  }

  /** Reads every tool call status of the run under the run lock, then applies the reference rules. */
  async transition(scope: TrustedScope, id: RunId, request: TransitionInput): Promise<StateResult<RunRecord>> {
    return this.mutate(scope, id, request.events, async (run, tx) => {
      const lost = leaseConflict(run, request.lease, request.at);
      if (lost !== undefined) return stateConflict(lost);
      const calls = await tx.query('SELECT status FROM viper_engine.tool_calls WHERE run_id = $1', [id]);
      const toolCalls = calls.rows.map(row => member(asRow(row), 'status', TOOL_CALL_STATUSES));
      return applyRunTransition(run.record, scope, { ...request, toolCalls });
    });
  }

  /** Idempotent: an unchanged run (terminal or already requested) writes nothing and appends no events. */
  async requestCancellation(scope: TrustedScope, id: RunId, at: number, events: readonly NewRunEvent[]) {
    return this.mutate(scope, id, events, async run => requestRunCancellation(run.record, scope, at));
  }

  /** User input/decision may wake a paused run without borrowing an execution lease. */
  async wake(scope: TrustedScope, id: RunId, request: {
    readonly expectedRevision: number; readonly at: number; readonly events: readonly NewRunEvent[];
  }): Promise<StateResult<RunRecord>> {
    return withTransaction(this.pool, async tx => {
      const locked = await lockRun(tx, scope, id);
      if (!locked.ok) return stateConflict(locked.error);
      const run = locked.value;
      const next = applyRunTransition(run.record, scope, { ...request, to: 'running', toolCalls: [],
        at: Math.max(request.at, run.leaseCheckedAt ?? request.at) });
      if (!next.ok) return next;
      if (!WAKEABLE.has(run.record.status)) {
        return stateConflict({ code: 'invalid_transition', message: 'Only a waiting run may be woken' });
      }
      await tx.query(`UPDATE viper_engine.runs SET lease_owner = NULL, lease_expires_at = NULL,
        lease_fence = lease_fence + 1 WHERE id = $1`, [id]);
      await writeRun(tx, run.record, next.value);
      await appendEvents(tx, scope, run, revisionEvents(request.events, next.value));
      return next;
    });
  }

  private async mutate(
    scope: TrustedScope, id: RunId, events: readonly NewRunEvent[],
    decide: (run: LockedRun, tx: SqlQueryable) => Promise<StateResult<RunRecord>>,
  ): Promise<StateResult<RunRecord>> {
    return withTransaction(this.pool, async tx => {
      const locked = await lockRun(tx, scope, id);
      if (!locked.ok) return locked;
      const next = await decide(locked.value, tx);
      if (!next.ok || next.value.revision === locked.value.record.revision) return next;
      await writeRun(tx, locked.value.record, next.value);
      await appendEvents(tx, scope, locked.value, revisionEvents(events, next.value));
      return next;
    });
  }
}
