import type { RecallNote, SourceView } from '../../../contracts/recall/ports.js';
import { asRow, text, integer, member } from './rows.js';

export const MESSAGE_TEXT = `(SELECT string_agg(block->>'text', E'\n' ORDER BY ord)
  FROM jsonb_array_elements(m.content) WITH ORDINALITY AS b(block, ord) WHERE block->>'type' = 'text')`;
export const NOTE_SELECT = `SELECT n.id, n.revision, n.status, n.source_message_id, n.source_conversation_id,
  floor(extract(epoch FROM n.created_at)*1000)::bigint AS created_ms,
  floor(extract(epoch FROM n.updated_at)*1000)::bigint AS updated_ms,
  floor(extract(epoch FROM m.created_at)*1000)::bigint AS source_ms, m.position, ${MESSAGE_TEXT} AS source_text
  FROM viper_engine.memory_notes n LEFT JOIN viper_engine.messages m ON m.id = n.source_message_id
  AND m.conversation_id = n.source_conversation_id AND m.actor_id = n.actor_id AND m.app_id = n.app_id
  AND m.tenant_key = n.tenant_key AND m.role = 'user'`;
export const NOTE_OWNER = 'n.actor_id = $1 AND n.app_id = $2 AND n.tenant_key = $3';

export function note(value: unknown): RecallNote {
  const row = asRow(value); const status = member(row, 'status', ['active', 'deleted'] as const);
  if (status === 'active' && new TextEncoder().encode(text(row, 'source_text')).byteLength > 8192) throw new RangeError('Note source exceeds byte limit');
  const source: SourceView | undefined = status === 'deleted' ? undefined : { conversationId: text(row, 'source_conversation_id'),
    messageId: text(row, 'source_message_id'), role: 'user', position: integer(row, 'position'), createdAt: integer(row, 'source_ms') };
  return Object.freeze({ schemaVersion: 1, noteId: text(row, 'id'), revision: integer(row, 'revision'), status,
    trust: 'user_asserted', createdAt: integer(row, 'created_ms'), updatedAt: integer(row, 'updated_ms'),
    ...(source === undefined ? {} : { source: Object.freeze(source), text: text(row, 'source_text') }) });
}
export function page<T>(items: readonly T[], limit: number) {
  return Object.freeze({ schemaVersion: 1 as const, items: Object.freeze(items.slice(0, limit)), hasMore: items.length > limit });
}
