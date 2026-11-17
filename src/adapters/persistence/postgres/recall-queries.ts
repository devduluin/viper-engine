import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { HistoryHit, SearchQuery, NoteQuery } from '../../../contracts/recall/ports.js';
import { asRow, text, integer, member, ownerColumns } from './rows.js';
import type { SqlQueryable } from './sql-client.js';
import { MESSAGE_TEXT, NOTE_SELECT, NOTE_OWNER, note, page } from './recall-rows.js';

export async function search(tx: SqlQueryable, scope: TrustedScope, input: SearchQuery) {
  const result = await tx.query(`SELECT m.id, m.conversation_id, m.position, m.role, m.outcome,
    floor(extract(epoch FROM m.created_at)*1000)::bigint AS created_ms, left(${MESSAGE_TEXT}, 512) AS excerpt
    FROM viper_engine.messages m WHERE m.actor_id = $1 AND m.app_id = $2 AND m.tenant_key = $3
    AND ($4::text IS NULL OR m.conversation_id = $4) AND strpos(lower(${MESSAGE_TEXT}), lower($5)) > 0
    ORDER BY m.created_at DESC, m.id DESC LIMIT $6`, [...ownerColumns(scope), input.conversationId ?? null, input.query, input.limit + 1]);
  const items: HistoryHit[] = result.rows.map(value => {
    const row = asRow(value);
    return Object.freeze({ conversationId: text(row, 'conversation_id'), messageId: text(row, 'id'), position: integer(row, 'position'),
      createdAt: integer(row, 'created_ms'), role: member(row, 'role', ['user', 'assistant', 'tool'] as const), excerpt: text(row, 'excerpt'),
      trust: 'untrusted_history', ...(row['outcome'] === null ? {} : { outcome: member(row, 'outcome', ['success', 'error', 'unknown'] as const) }) });
  });
  return page(items, input.limit);
}
export async function notes(tx: SqlQueryable, scope: TrustedScope, input: NoteQuery) {
  const result = await tx.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.status = 'active'
    AND ($4::text IS NULL OR strpos(lower(${MESSAGE_TEXT}), lower($4)) > 0)
    ORDER BY n.updated_at DESC, n.id DESC LIMIT $5`, [...ownerColumns(scope), input.query ?? null, input.limit + 1]);
  return page(result.rows.map(note), input.limit);
}
