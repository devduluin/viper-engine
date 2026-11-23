import { parseId } from '../../../contracts/identity/ids.js';
import type { ConversationId, RunId } from '../../../contracts/identity/ids.js';
import type { Message } from '../../../contracts/messages/message.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import type { StoredMessage } from '../../../contracts/state/checkpoints.js';
import type { StateConflict } from '../../../contracts/state/result.js';
import { asRow, integer, msColumn } from './rows.js';
import type { SqlQueryable, SqlResult } from './sql-client.js';

export const MESSAGE_COLUMNS = ['id', 'role', 'content', 'tool_calls', 'tool_call_id', 'outcome', 'position', 'run_id',
  msColumn('created_at')].join(', ');

export function storedMessage(value: unknown): StoredMessage {
  const row = asRow(value);
  const base = { id: row['id'], role: row['role'], content: row['content'] };
  const message = parseMessage(row['role'] === 'tool'
    ? { ...base, toolCallId: row['tool_call_id'], outcome: row['outcome'] }
    : row['tool_calls'] === null ? base : { ...base, toolCalls: row['tool_calls'] });
  return Object.freeze({
    message, position: integer(row, 'position'), createdAt: integer(row, 'created_at_ms'),
    ...(typeof row['run_id'] === 'string' ? { runId: parseId('run', row['run_id']) } : {}),
  });
}

const pairing = (message: string): StateConflict => ({ code: 'invalid_transition', message });

/**
 * Call/result pairing across the whole conversation, not just this batch: a tool result must
 * answer an earlier unanswered call, and call IDs are never reused.
 */
export async function pairingConflict(tx: SqlQueryable, conversationId: ConversationId, messages: readonly Message[], runId?: RunId): Promise<StateConflict | undefined> {
  const calls = await tx.query(`SELECT jsonb_array_elements(tool_calls)->>'id' AS id, run_id FROM viper_engine.messages
    WHERE conversation_id = $1 AND role = 'assistant' AND tool_calls IS NOT NULL`, [conversationId]);
  const answered = await tx.query(`SELECT tool_call_id AS id FROM viper_engine.messages WHERE conversation_id = $1 AND role = 'tool'`, [conversationId]);
  return validatePairing(calls.rows, answered.rows, messages, runId);
}

/** Driver-independent pairing rules. Input rows are selected in the append transaction. */
export function validatePairing(calls: SqlResult['rows'], answered: SqlResult['rows'], messages: readonly Message[], runId?: RunId): StateConflict | undefined {
  const origins = new Map(calls.map(row => [String(asRow(row)['id']), asRow(row)['run_id']]));
  const seen = new Set(origins.keys());
  const pending = new Set(seen);
  for (const row of answered) pending.delete(String(asRow(row)['id']));
  for (const message of messages) {
    if (message.role === 'system') return pairing('System instructions are not persisted as history');
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (seen.has(call.id)) return pairing(`Tool call ID ${call.id} was already used in this conversation`);
        seen.add(call.id);
        pending.add(call.id);
        origins.set(call.id, runId);
      }
    }
    const failure = resultConflict(message, pending, origins, runId);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function resultConflict(message: Message, pending: Set<string>, origins: Map<string, unknown>, runId?: RunId): StateConflict | undefined {
  if (message.role !== 'tool') return undefined;
  if (!pending.delete(message.toolCallId)) return pairing(`Tool result ${message.toolCallId} has no unanswered call`);
  if (origins.get(message.toolCallId) !== runId) return pairing('Tool result belongs to another run');
  return undefined;
}
