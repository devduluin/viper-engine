import type { TrustedScope } from '../identity/scope.js';
import type { StateResult } from '../state/result.js';

export interface NoteSource { readonly conversationId: string; readonly messageId: string }
export interface SourceView extends NoteSource { readonly role: 'user'; readonly position: number; readonly createdAt: number }
export interface RecallNote {
  readonly schemaVersion: 1; readonly noteId: string; readonly revision: number; readonly status: 'active' | 'deleted';
  readonly trust: 'user_asserted'; readonly createdAt: number; readonly updatedAt: number;
  readonly source?: SourceView; readonly text?: string;
}
export interface HistoryHit {
  readonly conversationId: string; readonly messageId: string; readonly position: number; readonly createdAt: number;
  readonly role: 'user' | 'assistant' | 'tool'; readonly outcome?: 'success' | 'error' | 'unknown';
  readonly excerpt: string; readonly trust: 'untrusted_history';
}
export interface RecallPage<T> { readonly schemaVersion: 1; readonly items: readonly T[]; readonly hasMore: boolean }
export interface SearchQuery { readonly query: string; readonly conversationId?: string; readonly limit: number }
export interface NoteQuery { readonly query?: string; readonly limit: number }
export interface NoteChange { readonly revision: number; readonly action: 'created' | 'corrected' | 'deleted'; readonly at: number; readonly source?: NoteSource }
export interface RecallStore {
  search(scope: TrustedScope, query: SearchQuery): Promise<RecallPage<HistoryHit>>;
  notes(scope: TrustedScope, query: NoteQuery): Promise<RecallPage<RecallNote>>;
  get(scope: TrustedScope, id: string): Promise<StateResult<RecallNote>>;
  changes(scope: TrustedScope, id: string, limit: number): Promise<StateResult<RecallPage<NoteChange>>>;
  create(scope: TrustedScope, id: string, source: NoteSource, at: number): Promise<StateResult<RecallNote>>;
  correct(scope: TrustedScope, id: string, revision: number, source: NoteSource, at: number): Promise<StateResult<RecallNote>>;
  delete(scope: TrustedScope, id: string, revision: number, at: number): Promise<StateResult<RecallNote>>;
}
