import { parseJsonObject } from '../messages/json.js';
import { id, revision } from './schema.js';

const text = { type: 'string', minLength: 1, maxLength: 8192 };
const object = (properties: object, required: readonly string[]) => ({ type: 'object', additionalProperties: false, properties, required });
const source = object({ conversationId: id, messageId: id, role: { const: 'user' }, position: revision,
  createdAt: { type: 'integer', minimum: 0 } }, ['conversationId', 'messageId', 'role', 'position', 'createdAt']);
const note = object({ schemaVersion: { const: 1 }, noteId: id, revision, status: { enum: ['active', 'deleted'] },
  trust: { const: 'user_asserted' }, createdAt: { type: 'integer', minimum: 0 }, updatedAt: { type: 'integer', minimum: 0 },
  source, text }, ['schemaVersion', 'noteId', 'revision', 'status', 'trust', 'createdAt', 'updatedAt']);

export const MEMORY_SCHEMAS = parseJsonObject({
  MemorySaveRequest: object({ text, requestId: id }, ['text', 'requestId']),
  MemoryCorrectRequest: object({ text, requestId: id, expectedRevision: revision }, ['text', 'requestId', 'expectedRevision']),
  MemoryDeleteRequest: object({ requestId: id, expectedRevision: revision }, ['requestId', 'expectedRevision']),
  MemoryListRequest: object({ query: { type: 'string', minLength: 2, maxLength: 256 } }, []),
  MemoryNote: note,
  MemoryPage: object({ schemaVersion: { const: 1 }, items: { type: 'array', maxItems: 50, items: note },
    hasMore: { type: 'boolean' } }, ['schemaVersion', 'items', 'hasMore']),
});
