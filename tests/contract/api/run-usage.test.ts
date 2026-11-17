import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValid } from './validate.js';
import { snapshot } from '../../support/client/fixtures.js';

test('RunSnapshot usage is an optional additive response with explicit unknown values', () => {
  assertValid('RunSnapshot', snapshot());
  assertValid('RunSnapshot', snapshot({ usage: { modelCalls: 0, source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } }));
  assertValid('RunUsage', { modelCalls: 2, source: 'mixed', inputTokens: 3, outputTokens: null, totalTokens: null });
  for (const invalid of [{ modelCalls: -1, source: 'provider', inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    { modelCalls: 1, source: 'provider', inputTokens: 0.5, outputTokens: 0, totalTokens: 0 },
    { modelCalls: 1, source: 'provider', inputTokens: 1, outputTokens: 1 }]) assert.throws(() => assertValid('RunUsage', invalid));
});
