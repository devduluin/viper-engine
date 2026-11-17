import type { RecallStore, SearchQuery, NoteQuery, NoteSource, NoteChange } from '../../../contracts/recall/ports.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { assertTrustedScope } from '../../../contracts/identity/scope.js';
import { stateOk } from '../../../contracts/state/result.js';
import { withSnapshot, withTransaction } from './sql-client.js';
import type { SqlPool, SqlQueryable } from './sql-client.js';
import { search, notes } from './recall-queries.js';
import { getNote, change } from './recall-commands.js';
import { asRow, text, integer, member, ownerColumns } from './rows.js';
import { page } from './recall-rows.js';
import { searchQuery, noteQuery, recallLimit, noteSource } from '../../../contracts/recall/validation.js';
import { parseId } from '../../../contracts/identity/ids.js';
import { parseRevision } from '../../../contracts/state/result.js';

export class PostgresRecallStore implements RecallStore {
  constructor(private readonly pool: SqlPool) {}
  private read<T>(scope: TrustedScope, work: (tx: SqlQueryable) => Promise<T>) {
    assertTrustedScope(scope); return withSnapshot(this.pool, async tx => { await tx.query("SET LOCAL statement_timeout = '5s'"); return work(tx); });
  }
  private write(scope: TrustedScope, id: string, action: 'created' | 'corrected' | 'deleted', at: number, input?: NoteSource, revision?: number) {
    parseId('note', id); if (revision !== undefined) parseRevision(revision);
    if (input !== undefined) input = noteSource(input);
    assertTrustedScope(scope); return withTransaction(this.pool, async tx => {
      await tx.query("SET LOCAL statement_timeout = '5s'"); return change(tx, scope, id, action, at, input, revision);
    });
  }
  search(scope: TrustedScope, input: SearchQuery) { input = searchQuery(input); return this.read(scope, tx => search(tx, scope, input)); }
  notes(scope: TrustedScope, input: NoteQuery) { input = noteQuery(input); return this.read(scope, tx => notes(tx, scope, input)); }
  get(scope: TrustedScope, id: string) { parseId('note', id); return this.read(scope, tx => getNote(tx, scope, id)); }
  create(scope: TrustedScope, id: string, input: NoteSource, at: number) { return this.write(scope, id, 'created', at, input); }
  correct(scope: TrustedScope, id: string, revision: number, input: NoteSource, at: number) { return this.write(scope, id, 'corrected', at, input, revision); }
  delete(scope: TrustedScope, id: string, revision: number, at: number) { return this.write(scope, id, 'deleted', at, undefined, revision); }
  changes(scope: TrustedScope, id: string, limit: number) {
    parseId('note', id); limit = recallLimit(limit);
    return this.read(scope, async tx => {
      const current = await getNote(tx, scope, id); if (!current.ok) return current;
      const result = await tx.query(`SELECT revision, action, source_conversation_id, source_message_id,
        floor(extract(epoch FROM created_at)*1000)::bigint AS at_ms FROM viper_engine.memory_note_changes
        WHERE actor_id = $1 AND app_id = $2 AND tenant_key = $3 AND note_id = $4 ORDER BY revision DESC LIMIT $5`, [...ownerColumns(scope), id, limit + 1]);
      const items: NoteChange[] = result.rows.map(value => { const row = asRow(value);
        return Object.freeze({ revision: integer(row, 'revision'), action: member(row, 'action', ['created', 'corrected', 'deleted'] as const), at: integer(row, 'at_ms'),
          ...(row['source_message_id'] === null ? {} : { source: Object.freeze({ conversationId: text(row, 'source_conversation_id'), messageId: text(row, 'source_message_id') }) }) }); });
      return stateOk(page(items, limit));
    });
  }
}
