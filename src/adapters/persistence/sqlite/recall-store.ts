import { parseId } from '../../../contracts/identity/ids.js';
import { assertTrustedScope } from '../../../contracts/identity/scope.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { NoteChange, NoteQuery, NoteSource, RecallNote, RecallStore, SearchQuery } from '../../../contracts/recall/ports.js';
import { noteQuery, noteSource, recallLimit, searchQuery } from '../../../contracts/recall/validation.js';
import { checkExpectedRevision, parseRevision, stateConflict, stateOk } from '../../../contracts/state/result.js';
import type { StateResult } from '../../../contracts/state/result.js';
import { page } from '../postgres/recall-rows.js';
import { asRow, integer, member, ownerColumns, text } from '../postgres/rows.js';
import type { SqlPool, SqlQueryable } from '../postgres/sql-client.js';
import { withSnapshot, withTransaction } from '../postgres/sql-client.js';
import { getNote, notes, search, userStatement } from './recall-queries.js';

type Action = NoteChange['action'];

async function nextRevision(tx: SqlQueryable, scope: TrustedScope, id: string, expected: number): Promise<StateResult<number>> {
  const current = await getNote(tx, scope, id);
  if (!current.ok) return current;
  const conflict = checkExpectedRevision(current.value.revision, expected);
  if (conflict !== undefined) return stateConflict(conflict);
  if (current.value.status === 'deleted') return stateConflict({ code: 'invalid_transition', message: 'Deleted note cannot be changed' });
  return stateOk(current.value.revision + 1);
}

async function writeNote(tx: SqlQueryable, scope: TrustedScope, id: string, action: Action, revision: number, at: number, source?: NoteSource) {
  const sourceFields = [source?.conversationId ?? null, source?.messageId ?? null];
  if (action === 'created') {
    await tx.query(`INSERT INTO viper_engine.memory_notes (id, actor_id, app_id, tenant_key, source_conversation_id,
      source_message_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ...ownerColumns(scope), ...sourceFields, at, at]);
    return;
  }
  await tx.query(`UPDATE viper_engine.memory_notes SET source_conversation_id = ?, source_message_id = ?, updated_at_ms = ?,
    revision = ?, status = ? WHERE id = ? AND actor_id = ? AND app_id = ? AND tenant_key = ?`,
  [...sourceFields, at, revision, action === 'deleted' ? 'deleted' : 'active', id, ...ownerColumns(scope)]);
}

export class SqliteRecallStore implements RecallStore {
  constructor(private readonly pool: SqlPool) {}

  search(scope: TrustedScope, input: SearchQuery) {
    assertTrustedScope(scope);
    const query = searchQuery(input);
    return withSnapshot(this.pool, tx => search(tx, scope, query));
  }

  notes(scope: TrustedScope, input: NoteQuery) {
    assertTrustedScope(scope);
    const query = noteQuery(input);
    return withSnapshot(this.pool, tx => notes(tx, scope, query));
  }

  get(scope: TrustedScope, id: string) {
    assertTrustedScope(scope);
    return getNote(this.pool, scope, parseId('note', id));
  }

  create(scope: TrustedScope, id: string, source: NoteSource, at: number) {
    return this.change(scope, id, 'created', at, noteSource(source));
  }

  correct(scope: TrustedScope, id: string, revision: number, source: NoteSource, at: number) {
    return this.change(scope, id, 'corrected', at, noteSource(source), parseRevision(revision));
  }

  delete(scope: TrustedScope, id: string, revision: number, at: number) {
    return this.change(scope, id, 'deleted', at, undefined, parseRevision(revision));
  }

  async changes(scope: TrustedScope, id: string, limit: number): Promise<StateResult<ReturnType<typeof page<NoteChange>>>> {
    assertTrustedScope(scope);
    const noteId = parseId('note', id);
    const size = recallLimit(limit);
    return withSnapshot(this.pool, async tx => {
      const current = await getNote(tx, scope, noteId);
      if (!current.ok) return current;
      const rows = await tx.query(`SELECT * FROM viper_engine.memory_note_changes WHERE actor_id = ? AND app_id = ?
        AND tenant_key = ? AND note_id = ? ORDER BY revision DESC LIMIT ?`, [...ownerColumns(scope), noteId, size + 1]);
      const entries = rows.rows.map(value => {
        const row = asRow(value);
        return Object.freeze({ revision: integer(row, 'revision'), action: member(row, 'action', ['created','corrected','deleted'] as const),
          at: integer(row, 'created_at_ms'), ...(row['source_message_id'] === null ? {} : {
            source: Object.freeze({ conversationId: text(row, 'source_conversation_id'), messageId: text(row, 'source_message_id') }),
          }) });
      });
      return stateOk(page(entries, size));
    });
  }

  private change(scope: TrustedScope, id: string, action: Action, at: number, source?: NoteSource, revision?: number): Promise<StateResult<RecallNote>> {
    assertTrustedScope(scope);
    const noteId = parseId('note', id);
    return withTransaction(this.pool, async tx => {
      const next = action === 'created' ? stateOk(1) : await nextRevision(tx, scope, noteId, revision ?? 0);
      if (!next.ok) return next;
      if (source !== undefined) {
        const statement = await userStatement(tx, scope, source);
        if (!statement.ok) return statement;
      }
      await writeNote(tx, scope, noteId, action, next.value, at, source);
      return getNote(tx, scope, noteId);
    });
  }
}
