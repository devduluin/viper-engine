import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelUsage } from '../../../src/contracts/models/usage.js';

test('model usage: cache parts are optional, bounded by inputTokens and null when usage is unavailable', () => {
  assert.deepEqual(parseModelUsage({ source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12 }),
    { source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  assert.deepEqual(parseModelUsage({ source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 6, cacheWriteTokens: 4 }),
    { source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 6, cacheWriteTokens: 4 });
  assert.throws(() => parseModelUsage({ source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 4 }), /exceed/);
  assert.throws(() => parseModelUsage({ source: 'provider', inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: -1 }), /Invalid token count/);
  assert.throws(() => parseModelUsage({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: 3 }), /Unavailable/);
  assert.deepEqual(parseModelUsage({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null }),
    { source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null });
  assert.throws(() => parseModelUsage({ source: 'provider', inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedTokens: 1 }), /Unexpected usage field/);
});
