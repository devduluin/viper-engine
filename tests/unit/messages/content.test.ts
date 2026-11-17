import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContent, parseContentBlock } from '../../../src/contracts/messages/parse-content.js';
import { parseJsonObject, parseJsonValue } from '../../../src/contracts/messages/json.js';

test('text, JSON, inline image and referenced audio retain provider-neutral content', () => {
  const content = parseContent([
    { type: 'text', text: 'Stock data' },
    { type: 'json', data: { stock: 5, available: true, notes: [null, 'ready'] } },
    { type: 'image', source: { kind: 'inline', mediaType: 'image/png', encoding: 'base64', data: 'aGVsbG8=' } },
    { type: 'audio', source: { kind: 'reference', mediaType: 'audio/wav', uri: 'artifact://voice-1' } },
  ]);
  assert.equal(content.length, 4);
  assert.equal(Object.isFrozen(content), true);
  assert.equal(Object.isFrozen(content[1]), true);
  assert.deepEqual(content[3], { type: 'audio', source: { kind: 'reference', mediaType: 'audio/wav', uri: 'artifact://voice-1' } });
});

test('JSON data is cloned and frozen rather than sharing external mutable values', () => {
  const original = { stock: 5, details: { counts: [1, 2] } };
  const parsed = parseJsonObject(original);
  original.details.counts.push(99);
  assert.deepEqual(parsed, { stock: 5, details: { counts: [1, 2] } });
  assert.equal(Object.isFrozen(parsed['details']), true);
  const withPrototypeKey = parseJsonObject(JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.hasOwn(withPrototypeKey, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(withPrototypeKey), Object.prototype);
});

test('non-JSON values, cycles, sparse arrays and excessive depth fail without coercion', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const invalid: unknown[] = [undefined, Number.NaN, Infinity, 1n, new Date(), () => 1, cyclic, new Array(1)];
  for (const value of invalid) assert.throws(() => parseJsonValue(value));
  assert.throws(() => parseJsonObject([]), /JSON object/);
  let deep: unknown = null;
  for (let index = 0; index < 34; index++) deep = { nested: deep };
  assert.throws(() => parseJsonValue(deep), /nesting exceeds/);
});

test('JSON accessor properties are rejected without invoking the getter', () => {
  let invoked = false;
  const input = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { invoked = true; return 'value'; } });
  assert.throws(() => parseJsonObject(input), /accessors/);
  assert.equal(invoked, false);
});

test('JSON snapshot rejects hidden/symbol fields rather than silently dropping data', () => {
  const hidden = Object.defineProperty({}, 'value', { value: 1, enumerable: false });
  assert.throws(() => parseJsonObject(hidden), /Non-enumerable/);
  assert.throws(() => parseJsonObject({ [Symbol('value')]: 1 }), /symbol properties/);
  const extraArrayField = Object.assign([1], { extra: 2 });
  assert.throws(() => parseJsonValue(extraArrayField), /array properties/);
});

test('JSON arrays cannot run custom iterators or indexed getters', () => {
  let invoked = false;
  const iterable = [1];
  Object.defineProperty(iterable, Symbol.iterator, { value: () => { invoked = true; return [2].values(); } });
  assert.throws(() => parseJsonValue(iterable), /symbol properties/);
  const accessor = Object.defineProperty([1], '0', { enumerable: true, get: () => { invoked = true; return 2; } });
  assert.throws(() => parseJsonValue(accessor), /accessors/);
  assert.equal(invoked, false);
  class SpecialArray extends Array<number> {}
  assert.throws(() => parseJsonValue(new SpecialArray(1, 2)), /plain JSON array/);
});

test('malformed content and media are rejected; no reference is fetched', () => {
  const invalid: unknown[] = [
    { type: 'text', text: 1 }, { type: 'invented' }, { type: 'json', data: undefined },
    { type: 'text', text: 'ok', actorId: 'override' },
    { type: 'image', source: { kind: 'inline', mediaType: 'image/png', encoding: 'hex', data: 'aa' } },
    { type: 'image', source: { kind: 'inline', mediaType: 'image/png', encoding: 'base64', data: 'invalid' } },
    { type: 'audio', source: { kind: 'reference', mediaType: '', uri: 'artifact://x' } },
  ];
  for (const value of invalid) assert.throws(() => parseContentBlock(value));
  assert.throws(() => parseContent(null), /content blocks/);
});
