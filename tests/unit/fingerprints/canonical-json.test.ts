import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../../../src/shared/fingerprints/canonical-json.js';

test('canonical JSON recursively sorts keys while preserving arrays and JSON scalar types', () => {
  assert.equal(canonicalJson({ z: 3, a: { y: false, x: [2, 1, null] } }), '{"a":{"x":[2,1,null],"y":false},"z":3}');
  assert.equal(canonicalJson({ a: { y: 2, x: 1 } }), canonicalJson({ a: { x: 1, y: 2 } }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.notEqual(canonicalJson({ value: 1 }), canonicalJson({ value: '1' }));
  assert.equal(canonicalJson(-0), '0');
});

test('strings and keys are escaped without delimiter ambiguity or Unicode normalization', () => {
  assert.equal(canonicalJson({ text: 'a|b=c\n"' }), '{"text":"a|b=c\\n\\\""}');
  assert.notEqual(canonicalJson({ a: 'b|c=d' }), canonicalJson({ a: 'b', c: 'd' }));
  assert.equal(canonicalJson({ emoji: '🙂' }), '{"emoji":"🙂"}');
  assert.notEqual(canonicalJson('é'), canonicalJson('e\u0301'));
  assert.throws(() => canonicalJson('\ud800'), /Unicode/);
  assert.throws(() => canonicalJson({ ['\udc00']: 1 }), /Unicode/);
});

test('unsupported and cyclic input is rejected instead of coerced or silently removed', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => 1, new Date(), cyclic, { a: undefined }]) {
    assert.throws(() => canonicalJson(value));
  }
  const shared = { value: 1 };
  assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"value":1},"b":{"value":1}}');
  let deep: unknown = null;
  for (let index = 0; index < 34; index++) deep = [deep];
  assert.throws(() => canonicalJson(deep), /nesting/);
});

test('accessors, iterators, symbols, sparse/extended arrays and hidden fields cannot alter a digest', () => {
  let invoked = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get: () => { invoked = true; return 1; } });
  const iterable = [1];
  Object.defineProperty(iterable, Symbol.iterator, { value: () => { invoked = true; return [2].values(); } });
  const hidden = Object.defineProperty({}, 'value', { value: 1 });
  for (const value of [getter, iterable, hidden, new Array(1), Object.assign([1], { extra: 2 }), { [Symbol('x')]: 1 }]) {
    assert.throws(() => canonicalJson(value));
  }
  assert.equal(invoked, false);
  assert.equal(canonicalJson(JSON.parse('{"__proto__":{"x":1}}')), '{"__proto__":{"x":1}}');
  assert.equal(canonicalJson(Object.assign(Object.create(null) as Record<string, number>, { b: 2, a: 1 })), '{"a":1,"b":2}');
});
