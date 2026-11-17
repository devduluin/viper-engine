import type { ConversationId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { MessageAppend, MessageStore, StoredMessage } from '../../../contracts/state/checkpoints.js';
import { checkOwnership } from '../../../contracts/state/owner.js';
import { checkExpectedRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateConflict, StateResult } from '../../../contracts/state/result.js';
import { isTerminalRunStatus } from '../../../contracts/state/run-state.js';
import { MESSAGE_COLUMNS, pairingConflict, storedMessage } from './message-rows.js';
import { appendEvents, leaseConflict, lockRun, NOT_FOUND } from './run-lock.js';
import type { LockedRun } from './run-lock.js';
import { asRow, CONVERSATION_COLUMNS, conversationRecord, integer, MS_PARAM, ownerColumns } from './rows.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { withSnapshot, withTransaction } from './sql-client.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';

type Appended = { readonly revision: number; readonly positions: readonly number[] };

async function lockConversation(tx: SqlQueryable, scope: TrustedScope, id: ConversationId) {
  const result = await tx.query(`SELECT ${CONVERSATION_COLUMNS}, next_message_position FROM viper_engine.conversations
    WHERE id = $1 FOR UPDATE`, [id]);
  if (result.rows[0] === undefined) return undefined;
  const record = conversationRecord(result.rows[0]);
  return checkOwnership(record.owner, scope) === undefined
    ? { record, next: integer(asRow(result.rows[0]), 'next_message_position') } : undefined;
}

/** Messages produced by a run: the run must belong here, be live, and the lease (if any) held. */
async function runGate(tx: SqlQueryable, scope: TrustedScope, id: ConversationId, input: MessageAppend): Promise<LockedRun | StateConflict | undefined> {
  if (input.runId === undefined) return input.events?.length ? { code: 'invalid_transition', message: 'Events require a run' } : undefined;
  const run = await lockRun(tx, scope, input.runId);
  if (!run.ok) return run.error;
  if (run.value.record.conversationId !== id) return NOT_FOUND;
  if (isTerminalRunStatus(run.value.record.status)) return { code: 'invalid_transition', message: 'Run is terminal; late messages are refused' };
  return leaseConflict(run.value, input.lease, input.at) ?? run.value;
}

async function insert(tx: SqlQueryable, scope: TrustedScope, id: ConversationId, input: MessageAppend, start: number): Promise<number[]> {
  const positions: number[] = [];
  for (const [index, message] of input.messages.entries()) {
    const position = start + index + 1;
    await tx.query(`INSERT INTO viper_engine.messages (id, actor_id, app_id, tenant_key, conversation_id, run_id, position, role,
        content, tool_calls, tool_call_id, outcome, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${MS_PARAM(13)})`, [
      message.id, ...ownerColumns(scope), id, input.runId ?? null, position, message.role, JSON.stringify(message.content),
      message.role === 'assistant' && message.toolCalls !== undefined ? JSON.stringify(message.toolCalls) : null,
      message.role === 'tool' ? message.toolCallId : null, message.role === 'tool' ? message.outcome : null, input.at,
    ]);
    positions.push(position);
  }
  return positions;
}

/** `messages` + `conversations.next_message_position`, appended under one conversation CAS. */
export class PostgresMessageStore implements MessageStore {
  constructor(private readonly pool: SqlPool) {}

  async append(scope: TrustedScope, id: ConversationId, input: MessageAppend): Promise<StateResult<Appended>> {
    if (input.messages.length === 0) throw new Error('Nothing to append');
    input = Object.freeze({ ...input, messages: Object.freeze(input.messages.map(parseMessage)) });
    if (input.runId === undefined && input.messages.some(message => message.role !== 'user')) {
      return stateConflict<Appended>({ code: 'invalid_transition', message: 'Assistant/tool messages require a run' });
    }
    return withTransaction(this.pool, async tx => {
      const gate = await runGate(tx, scope, id, input);
      if (gate !== undefined && !('record' in gate)) return stateConflict<Appended>(gate);
      const conversation = await lockConversation(tx, scope, id);
      if (conversation === undefined) return stateConflict<Appended>(NOT_FOUND);
      const failure = checkExpectedRevision(conversation.record.revision, input.expectedRevision)
        ?? await pairingConflict(tx, id, input.messages, input.runId);
      if (failure !== undefined) return stateConflict<Appended>(failure);
      const positions = await insert(tx, scope, id, input, conversation.next);
      const revision = conversation.record.revision + 1;
      await tx.query(`UPDATE viper_engine.conversations SET revision = $2, next_message_position = $3, updated_at = ${MS_PARAM(4)}
        WHERE id = $1`, [id, revision, conversation.next + input.messages.length, input.at]);
      if (gate !== undefined) await appendEvents(tx, scope, gate, input.events ?? []);
      return stateOk(Object.freeze({ revision, positions: Object.freeze(positions) }));
    });
  }

  async read(scope: TrustedScope, id: ConversationId, afterPosition: number, limit: number) {
    if (!Number.isSafeInteger(afterPosition) || afterPosition < 0) throw new RangeError('Invalid message cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError('Invalid message page size');
    return withSnapshot(this.pool, async tx => {
      const conversation = await tx.query(`SELECT revision FROM viper_engine.conversations
        WHERE id = $1 AND actor_id = $2 AND app_id = $3 AND tenant_key = $4`, [id, ...ownerColumns(scope)]);
      if (conversation.rows[0] === undefined) return stateConflict<{ revision: number; messages: readonly StoredMessage[] }>(NOT_FOUND);
      const result = await tx.query(`SELECT ${MESSAGE_COLUMNS} FROM viper_engine.messages
        WHERE conversation_id = $1 AND position > $2 ORDER BY position LIMIT $3`, [id, afterPosition, limit]);
      return stateOk(Object.freeze({
        revision: integer(asRow(conversation.rows[0]), 'revision'), messages: Object.freeze(result.rows.map(storedMessage)),
      }));
    });
  }
}

