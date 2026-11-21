import type { MemoryAuthoringPort, MemorySave, MemoryDelete } from '../../../contracts/recall/user-memory.js';
import type { RecallNote } from '../../../contracts/recall/ports.js';
import type { TrustedScope } from '../../../contracts/identity/scope.js';
import type { Clock, IdGenerator } from '../../../contracts/identity/ports.js';
import type { SqlPool } from './sql-client.js';
import { withTransaction } from './sql-client.js';
import { transactionPool } from './journal-commands.js';
import { PostgresRecallStore } from './recall-store.js';
import { PostgresConversationStore } from './run-store.js';
import { PostgresMessageStore } from './message-store.js';
import { PostgresApiControl } from './api-control.js';
import { PostgresIdempotencyStore } from './idempotency-store.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import { requireState, ApiFailure } from '../../../contracts/api/failure.js';
import { parseMessage } from '../../../contracts/messages/parse-message.js';
import { parseId } from '../../../contracts/identity/ids.js';
import { NOTE_SELECT, NOTE_OWNER, MESSAGE_TEXT, note as readNote } from './recall-rows.js';
import { ownerColumns } from './rows.js';

export class PostgresUserMemoryStore implements MemoryAuthoringPort {
  constructor(private readonly pool: SqlPool, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  save(scope: TrustedScope, input: MemorySave) {
    return this.mutate(scope, input.requestId, input, async (pool, notes, at) => {
      if (input.noteId === undefined) {
        await pool.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          createFingerprint({ owner: ownerColumns(scope), text: input.text }, { domain: 'viper.memory-text', version: '1' })]);
        const duplicate = await pool.query(`${NOTE_SELECT} WHERE ${NOTE_OWNER} AND n.status = 'active'
          AND ${MESSAGE_TEXT} = $4 ORDER BY n.id LIMIT 1`, [...ownerColumns(scope), input.text]);
        if (duplicate.rows[0] !== undefined) return readNote(duplicate.rows[0]);
      }
      const conversationId = this.ids.next('conversation'); const messageId = this.ids.next('message');
      requireState(await new PostgresConversationStore(pool).create(scope, { id: conversationId, title: 'User memory source', at }));
      requireState(await new PostgresMessageStore(pool).append(scope, conversationId, { expectedRevision: 1, at,
        messages: [parseMessage({ id: messageId, role: 'user', content: [{ type: 'text', text: input.text }] })] }));
      const source = { conversationId, messageId };
      const note = input.noteId === undefined
        ? requireState(await notes.create(scope, this.ids.next('note'), source, at))
        : requireState(await notes.correct(scope, input.noteId, input.expectedRevision ?? 0, source, at));
      // An explicitly authored preference has an immutable user source, not a new chat/model run.
      // Archive its source conversation atomically so it does not pollute chat history.
      await new PostgresApiControl(pool).deleteConversation(scope, conversationId, at);
      return note;
    });
  }
  delete(scope: TrustedScope, id: string, input: MemoryDelete) {
    return this.mutate(scope, input.requestId, { ...input, noteId: id }, async (_pool, notes, at) =>
      requireState(await notes.delete(scope, id, input.expectedRevision, at)));
  }
  private mutate(scope: TrustedScope, key: string, payload: object,
    work: (pool: SqlPool, notes: PostgresRecallStore, at: number) => Promise<RecallNote>) {
    return withTransaction(this.pool, async tx => {
      await tx.query("SET LOCAL statement_timeout = '5s'");
      const pool = transactionPool(tx); const notes = new PostgresRecallStore(pool); const at = this.clock.now();
      const idempotency = new PostgresIdempotencyStore(pool);
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
