import type { ConversationId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import type { MessageAppend, MessageStore, StoredMessage } from '../../../contracts/state/checkpoints.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { storedMessage, validatePairing } from '../postgres/message-rows.js';
import { leaseConflict, NOT_FOUND } from '../postgres/run-lock.js';
import type { LockedRun } from '../postgres/run-lock.js';
import { asRow, integer, ownerColumns, text } from '../postgres/rows.js';
import { withSnapshot, withTransaction } from '../postgres/sql-client.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { appendEvents, lockRun } from './run-store.js';

type Appended = { readonly revision: number; readonly positions: readonly number[] };

export function decodeMessage(row: unknown): StoredMessage {
  const data = asRow(row);
  return storedMessage({ ...data, content: JSON.parse(text(data, 'content')),
    tool_calls: data['tool_calls'] === null ? null : JSON.parse(text(data, 'tool_calls')) });
}

async function checkRun(tx: SqlQueryable, scope: TrustedScope, id: ConversationId, input: MessageAppend,
  clock: () => number): Promise<LockedRun | StateConflict | undefined> {
  if (input.runId === undefined) return input.events?.length ? { code: 'invalid_transition', message: 'Events require a run' } : undefined;
  const run = await lockRun(tx, scope, input.runId, clock);
  if (!run.ok) return run.error;
  if (run.value.record.conversationId !== id) return NOT_FOUND;
  if (isTerminalRunStatus(run.value.record.status)) return { code: 'invalid_transition', message: 'Run is terminal; late messages are refused' };
  return leaseConflict(run.value, input.lease, input.at) ?? run.value;
}

async function pairingConflict(tx: SqlQueryable, id: ConversationId, input: MessageAppend) {
  const calls = await tx.query(`SELECT json_extract(call.value, '$.id') AS id, m.run_id FROM viper_engine.messages AS m
    JOIN json_each(m.tool_calls) AS call WHERE m.conversation_id = ? AND m.role = 'assistant'`, [id]);
  const answered = await tx.query("SELECT tool_call_id AS id FROM viper_engine.messages WHERE conversation_id = ? AND role = 'tool'", [id]);
  return validatePairing(calls.rows, answered.rows, input.messages, input.runId);
}

async function insert(tx: SqlQueryable, scope: TrustedScope, id: ConversationId, input: MessageAppend, start: number) {
  const positions: number[] = [];
  for (const [index, message] of input.messages.entries()) {
    const position = start + index + 1;
    if (!Number.isSafeInteger(position)) throw new RangeError('Message position exceeds safe integer range');
    await tx.query(`INSERT INTO viper_engine.messages (id, actor_id, app_id, tenant_key, conversation_id, run_id, position, role,
        content, tool_calls, tool_call_id, outcome, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      message.id, ...ownerColumns(scope), id, input.runId ?? null, position, message.role, JSON.stringify(message.content),
      message.role === 'assistant' && message.toolCalls !== undefined ? JSON.stringify(message.toolCalls) : null,
      message.role === 'tool' ? message.toolCallId : null, message.role === 'tool' ? message.outcome : null, input.at,
    ]);
    positions.push(position);
  }
  return positions;
}

async function conversationCounts(tx: SqlQueryable, scope: TrustedScope, id: ConversationId) {
  const result = await tx.query(`SELECT revision, next_message_position FROM viper_engine.conversations
    WHERE id = ? AND actor_id = ? AND app_id = ? AND tenant_key = ?`, [id, ...ownerColumns(scope)]);
  const row = result.rows[0];
  return row === undefined ? undefined : { revision: integer(asRow(row), 'revision'), next: integer(asRow(row), 'next_message_position') };
}

export class SqliteMessageStore implements MessageStore {
  constructor(private readonly pool: SqlPool, private readonly clock: () => number = Date.now) {}

  async append(scope: TrustedScope, id: ConversationId, input: MessageAppend): Promise<StateResult<Appended>> {
    if (input.messages.length === 0) throw new Error('Nothing to append');
    const validated = { ...input, messages: input.messages.map(parseMessage) };
    if (validated.runId === undefined && validated.messages.some(message => message.role !== 'user')) {
      return stateConflict({ code: 'invalid_transition', message: 'Assistant/tool messages require a run' });
    }
    return withTransaction(this.pool, async tx => {
      const run = await checkRun(tx, scope, id, validated, this.clock);
      if (run !== undefined && !('record' in run)) return stateConflict<Appended>(run);
      const counts = await conversationCounts(tx, scope, id);
      if (counts === undefined) return stateConflict<Appended>(NOT_FOUND);
      const failure = checkExpectedRevision(counts.revision, validated.expectedRevision)
        ?? await pairingConflict(tx, id, validated);
      if (failure !== undefined) return stateConflict<Appended>(failure);
      const positions = await insert(tx, scope, id, validated, counts.next);
      const revision = counts.revision + 1;
      await tx.query(`UPDATE viper_engine.conversations SET revision = ?, next_message_position = ?, updated_at_ms = ?
        WHERE id = ?`, [revision, counts.next + positions.length, validated.at, id]);
      if (run !== undefined) await appendEvents(tx, run.record, scope, run.lastEventSequence, validated.events ?? []);
      return stateOk(Object.freeze({ revision, positions: Object.freeze(positions) }));
    });
  }

  async read(scope: TrustedScope, id: ConversationId, afterPosition: number, limit: number): ReturnType<MessageStore['read']> {
    if (!Number.isSafeInteger(afterPosition) || afterPosition < 0) throw new RangeError('Invalid message cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError('Invalid message page size');
    return withSnapshot(this.pool, async tx => {
      const counts = await conversationCounts(tx, scope, id);
      if (counts === undefined) return stateConflict(NOT_FOUND);
      const result = await tx.query(`SELECT * FROM viper_engine.messages
        WHERE conversation_id = ? AND position > ? ORDER BY position LIMIT ?`, [id, afterPosition, limit]);
      const messages = result.rows.map(decodeMessage);
      return stateOk(Object.freeze({ revision: counts.revision, messages: Object.freeze(messages) }));
    });
  }
}
