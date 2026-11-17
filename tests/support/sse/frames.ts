import assert from 'node:assert/strict';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import type { JsonObject } from '../../../src/contracts/messages/json.js';
import { assertValid } from '../../contract/api/validate.js';

export interface SseFrame { readonly cursor: string; readonly event: JsonObject }
export function parseFrame(text: string): SseFrame | undefined {
  if (text.startsWith(':') || text.trim() === '') return undefined;
  const lines = text.split('\n');
  const cursor = lines.find(line => line.startsWith('id: '))?.slice(4);
  const type = lines.find(line => line.startsWith('event: '))?.slice(7);
  const data = lines.find(line => line.startsWith('data: '))?.slice(6);
  assert.ok(cursor && data && type, text); assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  const event = parseJsonObject(JSON.parse(data)); assertValid('DurableEvent', event);
  assert.equal(event['type'], type); assert.notEqual(event['eventId'], cursor);
  return { cursor, event };
}
export function parseFrames(body: string): readonly SseFrame[] {
  return body.split('\n\n').flatMap(text => { const frame = parseFrame(text); return frame === undefined ? [] : [frame]; });
}
