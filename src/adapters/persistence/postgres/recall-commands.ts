import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NoteSource, RecallNote } from '../../../contracts/recall/ports.js';
import { stateConflict, stateOk, checkExpectedRevision } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { ownerColumns, MS_PARAM } from './rows.js';
import { NOTE_SELECT, NOTE_OWNER, note } from './recall-rows.js';
import type { SqlQueryable } from './sql-client.js';
import { userStatement } from './user-statement.js';

export async function getNote(tx: SqlQueryable, scope: TrustedScope, id: string, lock = false): Promise<StateResult<RecallNote>> {
  const result = await tx.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.id = $4${lock ? ' FOR UPDATE OF n' : ''}`, [...ownerColumns(scope), id]);
  return result.rows[0] === undefined ? stateConflict({ code: 'not_found', message: 'Note not found' }) : stateOk(note(result.rows[0]));
}
export async function change(tx: SqlQueryable, scope: TrustedScope, id: string, action: 'created' | 'corrected' | 'deleted',
  at: number, input?: NoteSource, expectedRevision?: number): Promise<StateResult<RecallNote>> {
  const next = action === 'created' ? stateOk(1) : await nextRevision(tx, scope, id, expectedRevision ?? 0);
  if (!next.ok) return next; const revision = next.value;
  if (input !== undefined) { const statement = await userStatement(tx, scope, input); if (!statement.ok) return statement; }
  await write(tx, scope, id, action, revision, at, input);
  return getNote(tx, scope, id);
}
async function nextRevision(tx: SqlQueryable, scope: TrustedScope, id: string, expected: number): Promise<StateResult<number>> {
  const current = await getNote(tx, scope, id, true); if (!current.ok) return current;
  const conflict = checkExpectedRevision(current.value.revision, expected); if (conflict !== undefined) return stateConflict(conflict);
  if (current.value.status === 'deleted') return stateConflict({ code: 'invalid_transition', message: 'Deleted note cannot be changed' });
  return stateOk(current.value.revision + 1);
}
async function write(tx: SqlQueryable, scope: TrustedScope, id: string, action: string, revision: number, at: number, input?: NoteSource) {
  const values = [id, ...ownerColumns(scope), input?.conversationId ?? null, input?.messageId ?? null, at];
  if (action === 'created') {
    await tx.query(`INSERT INTO viper_engine.memory_notes (id, actor_id, app_id, tenant_key, source_conversation_id, source_message_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, ${MS_PARAM(7)}, ${MS_PARAM(7)})`, values); return;
  }
  await tx.query(`UPDATE viper_engine.memory_notes SET source_conversation_id = $5, source_message_id = $6,
    updated_at = ${MS_PARAM(7)}, revision = $8, status = $9 WHERE id = $1 AND actor_id = $2 AND app_id = $3 AND tenant_key = $4`,
  [...values, revision, action === 'deleted' ? 'deleted' : 'active']);
}
