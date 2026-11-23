import { ApiFailure, requireState } from '../../../contracts/api/failure.js';
import { parseId } from '../../../contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../../../contracts/identity/ports.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import type { RecallNote } from '../../../contracts/recall/ports.js';
import type { MemoryAuthoringPort, MemoryDelete, MemorySave } from '../../../contracts/recall/user-memory.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { transactionPool } from '../postgres/journal-commands.js';
import { withTransaction } from '../postgres/sql-client.js';
import type { SqlPool } from '../postgres/sql-client.js';
import { SqliteApiControl } from './api-control.js';
import { SqliteIdempotencyStore } from './idempotency-store.js';
import { SqliteMessageStore } from './message-store.js';
import { duplicateNote } from './recall-queries.js';
import { SqliteRecallStore } from './recall-store.js';
import { SqliteConversationStore } from './run-store.js';

export class SqliteUserMemoryStore implements MemoryAuthoringPort {
  constructor(private readonly pool: SqlPool, private readonly clock: Clock, private readonly ids: IdGenerator) {}

  save(scope: TrustedScope, input: MemorySave) {
    return this.mutate(scope, input.requestId, input, async (pool, notes, at) => {
      if (input.noteId === undefined) {
        const duplicate = await duplicateNote(pool, scope, input.text);
        if (duplicate !== undefined) return duplicate;
      }
      const conversationId = this.ids.next('conversation');
      const messageId = this.ids.next('message');
      requireState(await new SqliteConversationStore(pool).create(scope, { id: conversationId, title: 'User memory source', at }));
      const message = parseMessage({ id: messageId, role: 'user', content: [{ type: 'text', text: input.text }] });
      requireState(await new SqliteMessageStore(pool).append(scope, conversationId, { expectedRevision: 1, at, messages: [message] }));
      const source = { conversationId, messageId };
      const note = input.noteId === undefined
        ? requireState(await notes.create(scope, this.ids.next('note'), source, at))
        : requireState(await notes.correct(scope, input.noteId, input.expectedRevision ?? 0, source, at));
      await new SqliteApiControl(pool).deleteConversation(scope, conversationId, at);
      return note;
    });
  }

  delete(scope: TrustedScope, id: string, input: MemoryDelete) {
    return this.mutate(scope, input.requestId, { ...input, noteId: id }, async (_pool, notes, at) =>
      requireState(await notes.delete(scope, id, input.expectedRevision, at)));
  }

  private mutate(scope: TrustedScope, key: string, payload: object,
    work: (pool: SqlPool, notes: SqliteRecallStore, at: number) => Promise<RecallNote>) {
    return withTransaction(this.pool, async tx => {
      const pool = transactionPool(tx);
      const notes = new SqliteRecallStore(pool);
      const at = this.clock.now();
      const idempotency = new SqliteIdempotencyStore(pool);
      const request = { operation: 'memory.author', key,
        fingerprint: createFingerprint(payload, { domain: 'viper.user-memory', version: '1' }) };
      const claim = requireState(await idempotency.begin(scope, { ...request, at, ttlMs: 86400000 }));
      if (claim.status === 'replay') return requireState(await notes.get(scope, parseId('note', claim.resourceRef)));
      if (claim.status !== 'started') throw new ApiFailure('REVISION_CONFLICT');
      const note = await work(pool, notes, at);
      requireState(await idempotency.complete(scope, { ...request, claimId: claim.claimId, resourceRef: note.noteId }));
      return note;
    });
  }
}
