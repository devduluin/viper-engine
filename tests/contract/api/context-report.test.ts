import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValid } from './validate.js';
import { snapshot } from '../../support/client/fixtures.js';

const report = { inputMessages: 100, selectedMessages: 12, omittedMessages: 89, beforeTokens: 20000,
  afterTokens: 2000, inputBytes: 12000, approximate: true, hasUnpricedMedia: false, excludesProviderFraming: true };
test('context report is an additive response with explicit estimate provenance and no excerpt', () => {
  assertValid('RunSnapshot', snapshot()); assertValid('ContextReport', report);
  assertValid('RunSnapshot', { ...snapshot(), context: report });
  assertValid('ContextReport', { ...report, omittedMessages: 0 });
  assert.throws(() => assertValid('ContextReport', { ...report, approximate: false }));
  assert.throws(() => assertValid('ContextReport', { ...report, omittedMessages: -1 }));
  assert.throws(() => assertValid('ContextReport', { ...report, excerpt: 'private prompt history' }));
});
