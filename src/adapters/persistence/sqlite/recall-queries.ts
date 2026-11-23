import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { HistoryHit, NoteQuery, NoteSource, RecallNote, SearchQuery } from '../../../contracts/recall/ports.js';
import { stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { note, page } from '../postgres/recall-rows.js';
import { asRow, integer, member, ownerColumns, text } from '../postgres/rows.js';
import type { SqlQueryable } from '../postgres/sql-client.js';
import { userStatementFromRow } from '../postgres/user-statement.js';

const MESSAGE_TEXT = `(SELECT group_concat(json_extract(b.value, '$.text'), char(10) ORDER BY b.key)
  FROM json_each(m.content) b WHERE json_extract(b.value, '$.type') = 'text')`;
const NOTE_SELECT = `SELECT n.*, n.created_at_ms AS created_ms, n.updated_at_ms AS updated_ms,
  m.created_at_ms AS source_ms, m.position, ${MESSAGE_TEXT} AS source_text FROM viper_engine.memory_notes n
  LEFT JOIN viper_engine.messages m ON m.id = n.source_message_id AND m.conversation_id = n.source_conversation_id
    AND m.actor_id = n.actor_id AND m.app_id = n.app_id AND m.tenant_key = n.tenant_key AND m.role = 'user'`;
const NOTE_OWNER = 'n.actor_id = ? AND n.app_id = ? AND n.tenant_key = ?';

export async function getNote(tx: SqlQueryable, scope: TrustedScope, id: string): Promise<StateResult<RecallNote>> {
  const result = await tx.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.id = ?`, [...ownerColumns(scope), id]);
  return result.rows[0] === undefined ? stateConflict({ code: 'not_found', message: 'Note not found' }) : stateOk(note(result.rows[0]));
}

export async function duplicateNote(tx: SqlQueryable, scope: TrustedScope, value: string): Promise<RecallNote | undefined> {
  const result = await tx.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.status = 'active'
    AND ${MESSAGE_TEXT} = ? ORDER BY n.id LIMIT 1`, [...ownerColumns(scope), value]);
  return result.rows[0] === undefined ? undefined : note(result.rows[0]);
}

export async function search(tx: SqlQueryable, scope: TrustedScope, input: SearchQuery) {
  const result = await tx.query(`SELECT m.id, m.conversation_id, m.position, m.role, m.outcome,
    m.created_at_ms, substr(${MESSAGE_TEXT}, 1, 512) AS excerpt
    FROM viper_engine.messages m WHERE m.actor_id = ? AND m.app_id = ? AND m.tenant_key = ?
    AND (? IS NULL OR m.conversation_id = ?) AND instr(unicode_lower(${MESSAGE_TEXT}), unicode_lower(?)) > 0
    ORDER BY m.created_at_ms DESC, m.id DESC LIMIT ?`,
  [...ownerColumns(scope), input.conversationId ?? null, input.conversationId ?? null, input.query, input.limit + 1]);
  const items: HistoryHit[] = result.rows.map(value => {
    const row = asRow(value);
    return Object.freeze({ conversationId: text(row, 'conversation_id'), messageId: text(row, 'id'), position: integer(row, 'position'),
      createdAt: integer(row, 'created_at_ms'), role: member(row, 'role', ['user', 'assistant', 'tool'] as const), excerpt: text(row, 'excerpt'),
      trust: 'untrusted_history', ...(row['outcome'] === null ? {} : { outcome: member(row, 'outcome', ['success', 'error', 'unknown'] as const) }) });
  });
  return page(items, input.limit);
}

export async function notes(tx: SqlQueryable, scope: TrustedScope, input: NoteQuery) {
  const result = await tx.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.status = 'active'
    AND (? IS NULL OR instr(unicode_lower(${MESSAGE_TEXT}), unicode_lower(?)) > 0)
    ORDER BY n.updated_at_ms DESC, n.id DESC LIMIT ?`, [...ownerColumns(scope), input.query ?? null, input.query ?? null, input.limit + 1]);
  return page(result.rows.map(note), input.limit);
}

export async function userStatement(tx: SqlQueryable, scope: TrustedScope, input: NoteSource) {
  const result = await tx.query(`SELECT role, content, position, created_at_ms FROM viper_engine.messages
    WHERE actor_id = ? AND app_id = ? AND tenant_key = ? AND conversation_id = ? AND id = ?`,
  [...ownerColumns(scope), input.conversationId, input.messageId]);
  if (result.rows[0] === undefined) return stateConflict<never>({ code: 'not_found', message: 'Source not found' });
  const row = asRow(result.rows[0]);
  return userStatementFromRow({ ...row, content: JSON.parse(text(row, 'content')) }, input);
}
