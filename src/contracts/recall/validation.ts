import { parseId } from '../identity/ids.js';
import { parseJsonObject } from '../messages/json.js';
import type { NoteSource, NoteQuery, SearchQuery } from './ports.js';

export function recallLimit(value = 20): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new RangeError('Recall limit must be 1..50'); return value;
}
export function recallQuery(value: string): string {
  if (typeof value !== 'string' || value.trim().length < 2 || new TextEncoder().encode(value).byteLength > 256) throw new Error('Recall query must be 2..256 UTF8 bytes');
  return value.trim();
}
export function noteSource(value: NoteSource): NoteSource {
  const input = parseJsonObject(value);
  if (Object.keys(input).some(key => !['conversationId', 'messageId'].includes(key))) throw new Error('Invalid note source');
  return Object.freeze({ conversationId: parseId('conversation', input['conversationId']), messageId: parseId('message', input['messageId']) });
}
export function searchQuery(value: SearchQuery): SearchQuery {
  return Object.freeze({ query: recallQuery(value.query), limit: recallLimit(value.limit),
    ...(value.conversationId === undefined ? {} : { conversationId: parseId('conversation', value.conversationId) }) });
}
export function noteQuery(value: NoteQuery): NoteQuery {
  return Object.freeze({ limit: recallLimit(value.limit), ...(value.query === undefined ? {} : { query: recallQuery(value.query) }) });
}
