import type { TrustedScope } from '../identity/scope.js';
import type { RecallNote, RecallPage } from './ports.js';

export interface MemorySave {
  readonly text: string; readonly requestId: string;
  readonly noteId?: string; readonly expectedRevision?: number;
}
export interface MemoryDelete { readonly requestId: string; readonly expectedRevision: number }
export interface UserMemoryPort {
  list(scope: TrustedScope, query?: string): Promise<RecallPage<RecallNote>>;
  search(scope: TrustedScope, query: string): Promise<RecallPage<RecallNote>>;
  save(scope: TrustedScope, input: MemorySave): Promise<RecallNote>;
  delete(scope: TrustedScope, id: string, input: MemoryDelete): Promise<RecallNote>;
}
export type MemoryAuthoringPort = Pick<UserMemoryPort, 'save' | 'delete'>;
