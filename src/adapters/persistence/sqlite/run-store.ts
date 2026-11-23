import type { ConversationId, RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NewRunEvent } from '../../../contracts/state/events.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import type { ConversationStore, RunStore } from '../../../contracts/state/ports.js';
import type { RunRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { TOOL_CALL_STATUSES } from '../../../contracts/state/tool-call-state.js';
import { applyRunTransition, requestRunCancellation } from '../../../contracts/state/transitions.js';
import { leaseConflict, leaseStateOf, NOT_FOUND } from '../postgres/run-lock.js';
import type { LockedRun } from '../postgres/run-lock.js';
import { asRow, conversationRecord, integer, member, ownerColumns, runRecord } from '../postgres/rows.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';

function owned<T extends Pick<RunRecord, 'owner'>>(scope: TrustedScope, row: unknown, decode: (row: unknown) => T): StateResult<T> {
  if (row === undefined) return stateConflict(NOT_FOUND);
  const record = decode(row);
  const failure = checkOwnership(record.owner, scope);
  return failure === undefined ? stateOk(record) : stateConflict(failure);
}

export class SqliteConversationStore implements ConversationStore {
  constructor(private readonly pool: SqlPool) {}

  async create(scope: TrustedScope, input: Parameters<ConversationStore['create']>[1]) {
    const row = await this.pool.query(`INSERT INTO viper_engine.conversations
      (id, actor_id, app_id, tenant_key, title, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [input.id, ...ownerColumns(scope), input.title ?? null, input.at, input.at]);
    return stateOk(conversationRecord(row.rows[0]));
  }

  async get(scope: TrustedScope, id: ConversationId) {
    return getConversation(this.pool, scope, id);
  }
}

async function getConversation(tx: SqlQueryable, scope: TrustedScope, id: ConversationId) {
  const result = await tx.query('SELECT * FROM viper_engine.conversations WHERE id = ? AND deleted_at_ms IS NULL', [id]);
  return owned(scope, result.rows[0], conversationRecord);
}

export async function appendEvents(tx: SqlQueryable, record: RunRecord, scope: TrustedScope, last: number, events: readonly NewRunEvent[]) {
  if (events.length === 0) return;
  let sequence = last;
  for (const event of events) {
    sequence += 1;
    if (!Number.isSafeInteger(sequence)) throw new RangeError('Run event sequence exceeds safe integer range');
    await tx.query(`INSERT INTO viper_engine.run_events (run_id, sequence, event_id, actor_id, app_id, tenant_key,
      conversation_id, type, step_id, model_call_id, tool_call_id, occurred_at_ms, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, sequence, event.eventId, ...ownerColumns(scope), record.conversationId, event.type,
      event.stepId ?? null, event.modelCallId ?? null, event.toolCallId ?? null, event.occurredAt, JSON.stringify(event.payload)]);
  }
  await tx.query('UPDATE viper_engine.runs SET last_event_sequence = ? WHERE id = ?', [sequence, record.id]);
}

export async function lockRun(tx: SqlQueryable, scope: TrustedScope, id: RunId, clock: () => number): Promise<StateResult<LockedRun>> {
  const result = await tx.query('SELECT * FROM viper_engine.runs WHERE id = ?', [id]);
  const row = result.rows[0];
  const record = owned(scope, row, runRecord);
  if (!record.ok) return record;
  return stateOk({ record: record.value, lease: leaseStateOf(row), leaseCheckedAt: clock(),
    lastEventSequence: integer(asRow(row), 'last_event_sequence') });
}

function revisionEvents(events: readonly NewRunEvent[], record: RunRecord): readonly NewRunEvent[] {
  return events.map(event => event.type.startsWith('run.') ? { ...event, payload: { ...event.payload, revision: record.revision } } : event);
}

export class SqliteRunStore implements RunStore {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now) {}

  async create(scope: TrustedScope, input: Parameters<RunStore['create']>[1]) {
    return withTransaction(this.pool, async tx => {
      const parent = await getConversation(tx, scope, input.conversationId);
      if (!parent.ok) return parent;
      const clientTools = input.clientTools?.length ? JSON.stringify(input.clientTools) : null;
      const result = await tx.query(`INSERT INTO viper_engine.runs
        (id, actor_id, app_id, tenant_key, conversation_id, status, created_at_ms, updated_at_ms, effort, client_tools)
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?) RETURNING *`,
      [input.id, ...ownerColumns(scope), input.conversationId, input.at, input.at, input.effort ?? null, clientTools]);
      const record = runRecord(result.rows[0]);
      await appendEvents(tx, record, scope, 0, revisionEvents(input.events, record));
      return stateOk(record);
    });
  }

  async get(scope: TrustedScope, id: RunId) {
    const result = await this.pool.query('SELECT * FROM viper_engine.runs WHERE id = ?', [id]);
    return owned(scope, result.rows[0], runRecord);
  }

  async transition(scope: TrustedScope, id: RunId, request: Parameters<RunStore['transition']>[2]) {
    return this.mutate(scope, id, request.events, async (run, tx) => {
      const lost = leaseConflict(run, request.lease, request.at);
      if (lost !== undefined) return stateConflict(lost);
      const calls = await tx.query('SELECT status FROM viper_engine.tool_calls WHERE run_id = ?', [id]);
      const toolCalls = calls.rows.map(row => member(asRow(row), 'status', TOOL_CALL_STATUSES));
      return applyRunTransition(run.record, scope, { ...request, toolCalls });
    });
  }

  async requestCancellation(scope: TrustedScope, id: RunId, at: number, events: readonly NewRunEvent[]) {
    return this.mutate(scope, id, events, async run => requestRunCancellation(run.record, scope, at));
  }

  async wake(scope: TrustedScope, id: RunId, request: Parameters<RunStore['wake']>[2]) {
    return this.mutate(scope, id, request.events, async (run, tx) => {
      const next = applyRunTransition(run.record, scope, { ...request, to: 'running', toolCalls: [],
        at: Math.max(request.at, run.leaseCheckedAt ?? request.at) });
      if (!next.ok) return next;
      if (run.record.status !== 'waiting_for_input' && run.record.status !== 'waiting_for_approval') {
        return stateConflict({ code: 'invalid_transition', message: 'Only a waiting run may be woken' });
      }
      await tx.query(`UPDATE viper_engine.runs SET lease_owner = NULL, lease_expires_at_ms = NULL,
        lease_fence = lease_fence + 1 WHERE id = ?`, [id]);
      return next;
    });
  }

  private async mutate(scope: TrustedScope, id: RunId, events: readonly NewRunEvent[],
    decide: (run: LockedRun, tx: SqlQueryable) => Promise<StateResult<RunRecord>>) {
    return withTransaction(this.pool, async tx => {
      const locked = await lockRun(tx, scope, id, this.clock);
      if (!locked.ok) return locked;
      const next = await decide(locked.value, tx);
      if (!next.ok || next.value.revision === locked.value.record.revision) return next;
      const record = next.value;
      const result = await tx.query(`UPDATE viper_engine.runs SET status = ?, revision = ?, cancel_requested_at_ms = ?,
        updated_at_ms = ? WHERE id = ? AND revision = ?`,
      [record.status, record.revision, record.cancelRequestedAt ?? null, record.updatedAt, id, locked.value.record.revision]);
      if (result.rowCount !== 1) throw new Error('Run row changed while locked');
      await appendEvents(tx, record, scope, locked.value.lastEventSequence, revisionEvents(events, record));
      return next;
    });
  }
}
