import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { ConversationId, RunId } from '../../../contracts/identity/ids.js';
import type { Message } from '../../../contracts/messages/message.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { ApiControlStore } from '../../../contracts/api/control.js';
import { withSnapshot } from './sql-client.js';
import type { SqlPool } from './sql-client.js';
import { lockRun, NOT_FOUND } from './run-lock.js';
import { conversationRecord, CONVERSATION_COLUMNS, ownerColumns, asRow, text } from './rows.js';
import { PostgresApiConnections } from './api-connections.js';

export class PostgresApiControl extends PostgresApiConnections implements ApiControlStore {
  constructor(private readonly pool: SqlPool) { super(pool); }

  async lockConversation(scope: TrustedScope, id: ConversationId) {
    const result = await this.pool.query(`SELECT ${CONVERSATION_COLUMNS} FROM viper_engine.conversations
      WHERE id = $1 AND actor_id = $2 AND app_id = $3 AND tenant_key = $4 FOR UPDATE`, [id, ...ownerColumns(scope)]);
    return result.rows[0] === undefined ? stateConflict<ReturnType<typeof conversationRecord>>(NOT_FOUND) : stateOk(conversationRecord(result.rows[0]));
  }

  async lockRun(scope: TrustedScope, id: RunId) {
    const result = await lockRun(this.pool, scope, id);
    return result.ok ? stateOk(result.value.record) : stateConflict<import('../../../contracts/state/records.js').RunRecord>(result.error);
  }

  async hasActiveRun(id: ConversationId) {
    const result = await this.pool.query(`SELECT id FROM viper_engine.runs WHERE conversation_id = $1
      AND status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval') LIMIT 1`, [id]);
    return result.rows.length > 0;
  }

  async saveInstructions(scope: TrustedScope, runId: RunId, messages: readonly Message[]) {
    await this.pool.query(`INSERT INTO viper_engine.run_instructions (run_id, actor_id, app_id, tenant_key, messages)
      VALUES ($1, $2, $3, $4, $5)`, [runId, ...ownerColumns(scope), JSON.stringify(messages)]);
  }

  async inputReceipt(scope: TrustedScope, runId: RunId, inputId: string) {
    const result = await this.pool.query(`SELECT fingerprint, response FROM viper_engine.input_receipts
      WHERE run_id = $1 AND input_id = $2 AND actor_id = $3 AND app_id = $4 AND tenant_key = $5`, [runId, inputId, ...ownerColumns(scope)]);
    if (result.rows[0] === undefined) return undefined;
    const row = asRow(result.rows[0]);
    return { fingerprint: text(row, 'fingerprint'), response: parseJsonObject(row['response']) };
  }

  async saveInputReceipt(scope: TrustedScope, runId: RunId, inputId: string, fingerprint: string, response: JsonObject) {
    await this.pool.query(`INSERT INTO viper_engine.input_receipts (run_id, actor_id, app_id, tenant_key, input_id, fingerprint, response)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [runId, ...ownerColumns(scope), inputId, fingerprint, JSON.stringify(response)]);
  }
}

/** Consumed by the worker's trusted instruction callback, never by a public history endpoint. */
export async function loadRunInstructions(pool: SqlPool, scope: TrustedScope, runId: RunId): Promise<readonly Message[]> {
  return withSnapshot(pool, async tx => {
    const result = await tx.query(`SELECT messages FROM viper_engine.run_instructions WHERE run_id = $1
      AND actor_id = $2 AND app_id = $3 AND tenant_key = $4`, [runId, ...ownerColumns(scope)]);
    if (result.rows[0] === undefined) return [];
    const messages = asRow(result.rows[0])['messages'];
    if (!Array.isArray(messages)) throw new Error('Invalid saved instructions');
    return messages.map(parseMessage);
  });
}
