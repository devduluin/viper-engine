import type { RecallStore, RecallNote } from '../../../src/contracts/recall/ports.js';

const unused = async (): Promise<never> => { throw new Error('Unexpected recall storage call'); };
export function recallStub(overrides: Partial<RecallStore> = {}): RecallStore {
  return { search: unused, notes: unused, get: unused, changes: unused, create: unused, correct: unused, delete: unused, ...overrides };
}
export const note: RecallNote = { schemaVersion: 1, noteId: 'note-1', revision: 1, status: 'active', trust: 'user_asserted',
  createdAt: 1, updatedAt: 1, text: 'Unverified preference',
  source: { conversationId: 'conversation-1', messageId: 'message-1', role: 'user', position: 1, createdAt: 1 } };
