import type { ConversationId } from '../../../src/contracts/identity/ids.js';
import { assertSameScope, assertTrustedScope } from '../../../src/contracts/identity/scope.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import { parseMessageHistory } from '../../../src/contracts/messages/history.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import type { ScopedHistory } from '../../../src/agent/context/assemble.js';

interface Snapshot extends ScopedHistory { readonly revision: number }

/** Test fixture collection only, not an alternative production ConversationStore/RunStore port. */
export class MemoryHistoryFixtures {
  private readonly records = new Map<ConversationId, Snapshot>();

  seed(scope: TrustedScope, conversationId: ConversationId, messages: readonly Message[]): Snapshot {
    assertTrustedScope(scope);
    if (this.records.has(conversationId)) throw new Error('Fixture history already exists');
    const snapshot = Object.freeze({ scope, conversationId, messages: parseMessageHistory(messages), revision: 0 });
    this.records.set(conversationId, snapshot);
    return snapshot;
  }

  read(scope: TrustedScope, conversationId: ConversationId): Snapshot {
    assertTrustedScope(scope);
    const snapshot = this.records.get(conversationId);
    if (snapshot === undefined) throw new Error('Fixture history not found');
    assertSameScope(snapshot.scope, scope);
    return snapshot;
  }

  append(scope: TrustedScope, conversationId: ConversationId, revision: number, messages: readonly Message[]): Snapshot {
    const previous = this.read(scope, conversationId);
    if (previous.revision !== revision) throw new Error('Stale fixture revision');
    const snapshot = Object.freeze({
      ...previous, revision: revision + 1,
      messages: parseMessageHistory([...previous.messages, ...messages]),
    });
    this.records.set(conversationId, snapshot);
    return snapshot;
  }
}
