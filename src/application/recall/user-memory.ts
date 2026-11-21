import type { UserMemoryPort, MemoryAuthoringPort, MemorySave, MemoryDelete } from '../../contracts/recall/user-memory.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { assertTrustedScope } from '../../contracts/identity/scope.js';
import { parseId } from '../../contracts/identity/ids.js';
import { parseRevision } from '../../contracts/state/result.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { recallQuery } from '../../contracts/recall/validation.js';
import type { EngineRecall } from './service.js';

/** Only explicit authenticated authoring becomes a note; model proposals cannot invoke these writes. */
export class UserMemory implements UserMemoryPort {
  constructor(private readonly recall: EngineRecall, private readonly authoring: MemoryAuthoringPort) {}
  list(scope: TrustedScope, query?: string) {
    assertTrustedScope(scope); return this.recall.notes(scope, { limit: 50, ...(query === undefined ? {} : { query: validQuery(query) }) });
  }
  search(scope: TrustedScope, query: string) {
    assertTrustedScope(scope); return this.recall.relevantNotes(scope, { query: validQuery(query), limit: 5, maxBytes: 4096 });
  }
  save(scope: TrustedScope, input: MemorySave) {
    assertTrustedScope(scope);
    const text = input.text.trim();
    if (text.length === 0 || new TextEncoder().encode(text).byteLength > 8192) throw new ApiFailure('INVALID_REQUEST');
    parseId('message', input.requestId);
    if (input.noteId === undefined && input.expectedRevision !== undefined) throw new ApiFailure('INVALID_REQUEST');
    if (input.noteId !== undefined) {
      parseId('note', input.noteId);
      if (input.expectedRevision === undefined) throw new ApiFailure('INVALID_REQUEST');
      parseRevision(input.expectedRevision);
    }
    return this.authoring.save(scope, { ...input, text });
  }
  delete(scope: TrustedScope, id: string, input: MemoryDelete) {
    assertTrustedScope(scope); parseId('note', id); parseId('message', input.requestId); parseRevision(input.expectedRevision);
    return this.authoring.delete(scope, id, input);
  }
}
function validQuery(query: string) {
  try { return recallQuery(query); } catch { throw new ApiFailure('INVALID_REQUEST'); }
}
