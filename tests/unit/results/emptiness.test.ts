import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmptyPrimitiveValue } from '../../../src/shared/results/emptiness.js';

test('null, undefined, blank strings and empty arrays are empty values', () => {
  for (const value of [null, undefined, '', '  ', '\n\t', []]) {
    assert.equal(isEmptyPrimitiveValue(value), true, JSON.stringify(value));
  }
});

test('zero, false, NaN, empty objects and nonempty containers stay nonempty (legacy parity)', () => {
  for (const value of [0, false, Number.NaN, {}, 'a', [0], [null], { a: 1 }, new Map()]) {
    assert.equal(isEmptyPrimitiveValue(value), false, String(value));
  }
});

test('the predicate is a value check, not an execution verdict for an empty read', () => {
  const successfulEmptyRead = { status: 'success', data: [] as unknown[] };
  assert.equal(isEmptyPrimitiveValue(successfulEmptyRead), false);
  assert.equal(isEmptyPrimitiveValue(successfulEmptyRead.data), true);
});
