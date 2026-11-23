import type { ApiControlStore, ConversationPosition } from '../../../contracts/api/control.js';
import { ApiFailure } from '../../../contracts/api/failure.js';
import type { ConversationId, RunId } from '../../../contracts/identity/ids.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import type { Message } from '../../../contracts/messages/message.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import type { ConversationRecord, RunRecord } from '../../../contracts/state/records.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { NOT_FOUND } from '../postgres/run-lock.js';
import { asRow, conversationRecord, integer, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { SqliteApiConnections } from './api-connections.js';
import { lockRun } from './run-store.js';
import { pendingSteeringCount, queueSteering } from './run-steering.js';

const OWNED = 'actor_id = ? AND app_id = ? AND tenant_key = ?';
const ACTIVE = "status IN ('queued','running','waiting_for_input','waiting_for_approval')";

// Control operations run on the connection held by the enclosing ApiDatabase transaction or snapshot.
export class SqliteApiControl extends SqliteApiConnections implements ApiControlStore {
  constructor(private readonly db: SqlQueryable, private readonly clock: () => number = Date.now) { super(db); }

  async lockConversation(scope: TrustedScope, id: ConversationId): Promise<StateResult<ConversationRecord>> {
    const result = await this.db.query(`SELECT * FROM viper_engine.conversations
      WHERE id = ? AND ${OWNED} AND deleted_at_ms IS NULL`, [id, ...ownerColumns(scope)]);
    return result.rows[0] === undefined ? stateConflict(NOT_FOUND) : stateOk(conversationRecord(result.rows[0]));
  }

  async lockRun(scope: TrustedScope, id: RunId): Promise<StateResult<RunRecord>> {
    const result = await lockRun(this.db, scope, id, this.clock);
    return result.ok ? stateOk(result.value.record) : stateConflict(result.error);
  }

  async listConversations(scope: TrustedScope, after: ConversationPosition | undefined, limit: number) {
    const position = after === undefined ? '' : 'AND (updated_at_ms, id COLLATE BINARY) < (?, ?)';
    const result = await this.db.query(`SELECT * FROM viper_engine.conversations
      WHERE ${OWNED} AND next_message_position > 0 AND deleted_at_ms IS NULL ${position}
      ORDER BY updated_at_ms DESC, id COLLATE BINARY DESC LIMIT ?`,
    [...ownerColumns(scope), ...(after === undefined ? [] : [after.updatedAt, after.id]), limit]);
    return result.rows.map(value => {
      const row = asRow(value);
      const title = row['title'];
      return { schemaVersion: 1, conversationId: text(row, 'id'), revision: integer(row, 'revision'),
        createdAt: integer(row, 'created_at_ms'), updatedAt: integer(row, 'updated_at_ms'),
        messageCount: integer(row, 'next_message_position'), ...(typeof title === 'string' && title !== '' ? { title } : {}) };
    });
  }

  async deleteConversation(scope: TrustedScope, id: ConversationId, at: number) {
    const found = await this.db.query(`SELECT deleted_at_ms FROM viper_engine.conversations WHERE id = ? AND ${OWNED}`, [id, ...ownerColumns(scope)]);
    if (found.rows[0] === undefined) throw new ApiFailure('NOT_FOUND');
    const row = asRow(found.rows[0]);
    if (row['deleted_at_ms'] !== null) return { schemaVersion: 1, conversationId: id, deletedAt: integer(row, 'deleted_at_ms') };
    if (await this.hasActiveRun(id)) throw new ApiFailure('INVALID_STATE');
    await this.db.query('UPDATE viper_engine.conversations SET deleted_at_ms = ?, revision = revision + 1 WHERE id = ?', [at, id]);
    return { schemaVersion: 1, conversationId: id, deletedAt: at };
  }

  async setConversationTitle(scope: TrustedScope, id: ConversationId, title: string) {
    const result = await this.db.query(`UPDATE viper_engine.conversations SET title = ?, revision = revision + 1
      WHERE id = ? AND ${OWNED} AND deleted_at_ms IS NULL RETURNING revision`, [title, id, ...ownerColumns(scope)]);
    if (result.rows[0] === undefined) throw new ApiFailure('NOT_FOUND');
    return { schemaVersion: 1, conversationId: id, revision: integer(asRow(result.rows[0]), 'revision'), title };
  }

  async hasActiveRun(id: ConversationId) {
    const result = await this.db.query(`SELECT id FROM viper_engine.runs WHERE conversation_id = ? AND ${ACTIVE} LIMIT 1`, [id]);
    return result.rows.length > 0;
  }

  async getActiveRun(id: ConversationId) {
    const result = await this.db.query(`SELECT r.id, r.status, r.revision, (SELECT m.id FROM viper_engine.messages m
      WHERE m.conversation_id = r.conversation_id AND m.run_id = r.id ORDER BY m.position LIMIT 1) AS first_message_id
      FROM viper_engine.runs r WHERE r.conversation_id = ? AND ${ACTIVE}
      ORDER BY r.created_at_ms DESC, r.id DESC LIMIT 1`, [id]);
    if (result.rows[0] === undefined) return undefined;
    const row = asRow(result.rows[0]);
    const first = row['first_message_id'];
    return { id: text(row, 'id'), status: text(row, 'status'), revision: integer(row, 'revision'),
      ...(typeof first === 'string' ? { firstMessageId: first } : {}) };
  }

  async saveInstructions(scope: TrustedScope, runId: RunId, messages: readonly Message[]) {
    await this.db.query(`INSERT INTO viper_engine.run_instructions (run_id, actor_id, app_id, tenant_key, messages)
      VALUES (?, ?, ?, ?, ?)`, [runId, ...ownerColumns(scope), JSON.stringify(messages)]);
  }

  async inputReceipt(scope: TrustedScope, runId: RunId, inputId: string) {
    const result = await this.db.query(`SELECT fingerprint, response FROM viper_engine.input_receipts
      WHERE run_id = ? AND input_id = ? AND ${OWNED}`, [runId, inputId, ...ownerColumns(scope)]);
    if (result.rows[0] === undefined) return undefined;
    const row = asRow(result.rows[0]);
    return { fingerprint: text(row, 'fingerprint'), response: parseJsonObject(JSON.parse(text(row, 'response'))) };
  }

  pendingSteering(runId: RunId) { return pendingSteeringCount(this.db, runId); }

  queueSteering(scope: TrustedScope, runId: RunId, input: Parameters<ApiControlStore['queueSteering']>[2]) {
    return queueSteering(this.db, scope, runId, input);
  }

  async saveInputReceipt(scope: TrustedScope, runId: RunId, inputId: string, fingerprint: string, response: JsonObject) {
    await this.db.query(`INSERT INTO viper_engine.input_receipts (run_id, actor_id, app_id, tenant_key, input_id, fingerprint, response)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [runId, ...ownerColumns(scope), inputId, fingerprint, JSON.stringify(response)]);
  }
}

export async function loadRunInstructions(db: SqlQueryable, scope: TrustedScope, runId: RunId): Promise<readonly Message[]> {
  const result = await db.query(`SELECT messages FROM viper_engine.run_instructions WHERE run_id = ? AND ${OWNED}`, [runId, ...ownerColumns(scope)]);
  if (result.rows[0] === undefined) return [];
  const messages: unknown = JSON.parse(text(asRow(result.rows[0]), 'messages'));
  if (!Array.isArray(messages)) throw new Error('Invalid saved instructions');
  return messages.map(parseMessage);
}
