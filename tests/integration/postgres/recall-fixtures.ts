import assert from 'node:assert/strict';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { PostgresMessageStore } from '../../../src/adapters/persistence/postgres/message-store.js';
import { stores, owner } from './fixtures.js';

export const userMessage = (id: string, text: string) => parseMessage({ id, role: 'user', content: [{ type: 'text', text }] });
export async function recallConversation(pool: SqlPool, suffix: string, scope: TrustedScope = owner,
  messages: readonly Message[] = [userMessage(`message-${suffix}`, 'Preference: Indonesian, concise answers')]) {
  const conversationId = parseId('conversation', `recall-${suffix}`); const s = stores(pool);
  assert.ok((await s.conversations.create(scope, { id: conversationId, at: Date.now() })).ok);
  assert.ok((await new PostgresMessageStore(pool).append(scope, conversationId, { expectedRevision: 1, at: Date.now(), messages })).ok);
  return { conversationId, messageId: messages[0]!.id };
}
