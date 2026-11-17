import type { RecallStore, NoteSource, SearchQuery, NoteQuery } from '../../contracts/recall/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { assertTrustedScope } from '../../contracts/identity/scope.js';
import type { Clock, IdGenerator } from '../../contracts/identity/ports.js';
import { requireState } from '../../contracts/api/failure.js';
import { recallLimit, searchQuery, noteQuery, noteSource } from '../../contracts/recall/validation.js';
import { parseId } from '../../contracts/identity/ids.js';
import { parseRevision } from '../../contracts/state/result.js';
import { recallEvidence } from './evidence.js';

export class EngineRecall {
  constructor(private readonly store: RecallStore, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  search(scope: TrustedScope, input: Omit<SearchQuery, 'limit'> & { readonly limit?: number }) {
    assertTrustedScope(scope); return this.store.search(scope, searchQuery({ ...input, limit: recallLimit(input.limit) }));
  }
  notes(scope: TrustedScope, input: Partial<NoteQuery> = {}) {
    assertTrustedScope(scope); return this.store.notes(scope, noteQuery({ ...input, limit: recallLimit(input.limit) }));
  }
  async getNote(scope: TrustedScope, id: string) {
    assertTrustedScope(scope); return requireState(await this.store.get(scope, parseId('note', id)));
  }
  async changes(scope: TrustedScope, id: string, limit = 20) {
    assertTrustedScope(scope); return requireState(await this.store.changes(scope, parseId('note', id), recallLimit(limit)));
  }
  async createNote(scope: TrustedScope, source: NoteSource) {
    assertTrustedScope(scope); return requireState(await this.store.create(scope, this.ids.next('note'), noteSource(source), this.clock.now()));
  }
  async correctNote(scope: TrustedScope, id: string, revision: number, source: NoteSource) {
    assertTrustedScope(scope); return requireState(await this.store.correct(scope, parseId('note', id), parseRevision(revision), noteSource(source), this.clock.now()));
  }
  async deleteNote(scope: TrustedScope, id: string, revision: number) {
    assertTrustedScope(scope); return requireState(await this.store.delete(scope, parseId('note', id), parseRevision(revision), this.clock.now()));
  }
  /** Host opts in to user-role, fresh untrusted evidence; never writes facts or calls a model. */
  evidence(scope: TrustedScope, input: { readonly query?: string; readonly conversationId?: string; readonly limit?: number } = {}) {
    assertTrustedScope(scope); return recallEvidence(this.store, scope, input);
  }
}
