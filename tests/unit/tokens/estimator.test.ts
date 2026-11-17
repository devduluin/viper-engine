import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEXT_TOKEN_FACTORS, estimateTextTokens } from '../../../src/shared/tokens/estimator.js';

// Values captured from legacy TokenEstimator.estimate with default options (see P02-03 handoff).
const LEGACY_FIXTURES: ReadonlyArray<readonly [string, number]> = [
  ['hello', 2],
  ['Hello, world!', 4],
  ['Apa kabar? Saya ingin melihat data absensi karyawan bulan ini.', 16],
  ['The quick brown fox jumps over the lazy dog.', 13],
  ['日本語のテキストです', 3],
  ['emoji 😀 test', 4],
  ['😀', 2],
  ['a+b=c', 2],
  ['x'.repeat(1000), 144],
  ['kata '.repeat(200), 273],
];

test('nonempty text matches legacy weighted estimates for Latin, Indonesian, CJK and emoji', () => {
  for (const [text, tokens] of LEGACY_FIXTURES) {
    assert.equal(estimateTextTokens(text).tokens, tokens, JSON.stringify(text.slice(0, 30)));
  }
});

test('empty text is zero and whitespace-only text is one token, not a phantom word', () => {
  assert.equal(estimateTextTokens('').tokens, 0);
  for (const text of [' ', '   \n\t']) assert.equal(estimateTextTokens(text).tokens, 1);
});

test('estimates are labeled approximate and returned as frozen values', () => {
  const result = estimateTextTokens('hello');
  assert.equal(result.approximate, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(DEFAULT_TEXT_TOKEN_FACTORS), true);
});

test('counts grow monotonically for repeated fixture text', () => {
  let previous = 0;
  for (const count of [1, 2, 5, 10, 50, 100]) {
    const tokens = estimateTextTokens('data absensi '.repeat(count)).tokens;
    assert.ok(tokens > previous, `${count} repeats gave ${tokens}`);
    previous = tokens;
  }
});

test('explicit factors change the estimate deterministically', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';
  assert.equal(estimateTextTokens(text, DEFAULT_TEXT_TOKEN_FACTORS).tokens, 13);
  assert.equal(estimateTextTokens(text, { charsPerToken: 4 }).tokens, 12);
  assert.equal(estimateTextTokens(text, { charsPerToken: 2, tokensPerWord: 1 }).tokens, 16);
});

test('invalid factors and nonstring input are rejected instead of silently defaulted', () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => estimateTextTokens('hello', { charsPerToken: value }), /charsPerToken/);
    assert.throws(() => estimateTextTokens('hello', { tokensPerWord: value }), /tokensPerWord/);
  }
  assert.throws(() => estimateTextTokens(42 as unknown as string), TypeError);
});

test('finite factors cannot produce infinite or unsafe token counts', () => {
  for (const factors of [
    { charsPerToken: Number.MIN_VALUE },
    { tokensPerWord: Number.MAX_VALUE },
    { charsPerToken: 1 / Number.MAX_SAFE_INTEGER },
    { tokensPerWord: Number.MAX_SAFE_INTEGER },
  ]) {
    assert.throws(() => estimateTextTokens('hello world', factors), /safe integer range/);
  }
  assert.deepEqual(estimateTextTokens('', { charsPerToken: Number.MIN_VALUE }), {
    tokens: 0, approximate: true,
  });
});
