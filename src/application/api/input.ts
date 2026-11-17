import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { IdGenerator } from '../../contracts/identity/ports.js';

export function text(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw new ApiFailure('INVALID_REQUEST');
  return value;
}
export function revision(body: JsonObject): number {
  const value = body['expectedRevision'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ApiFailure('INVALID_REQUEST');
  return value;
}
export function userMessage(body: JsonObject, ids: IdGenerator) {
  const input = parseJsonObject(body['input']);
  return parseMessage({ id: ids.next('message'), role: 'user', content: input['content'] });
}
