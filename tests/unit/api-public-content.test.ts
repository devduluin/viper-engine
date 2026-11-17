import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicMessage } from '../../src/application/api/projection.js';
import { parseMessage } from '../../src/contracts/messages/parse-message.js';
import { assertValid } from '../contract/api/validate.js';
import { parseJsonObject } from '../../src/contracts/messages/json.js';

test('long stored text fits the public schema without truncation or splitting Unicode pairs', () => {
  const text = 'a'.repeat(65535) + '🌏' + 'b'.repeat(65536);
  const projected = publicMessage(parseMessage({ id: 'long-text', role: 'assistant', content: [{ type: 'text', text }] }));
  assertValid('PublicMessage', projected);
  const blocks = projected['content'] as readonly { readonly text: string }[];
  assert.equal(blocks.map(block => block.text).join(''), text);
  assert.ok(blocks.every(block => !/[\uD800-\uDBFF]$/.test(block.text)));
});

test('more than 32 stored content blocks retain overflow evidence in a bounded JSON block', () => {
  const message = parseMessage({ id: 'many-blocks', role: 'user', content: Array.from({ length: 40 }, (_, n) => ({ type: 'text', text: String(n) })) });
  const projected = publicMessage(message); assertValid('PublicMessage', projected);
  const blocks = projected['content'] as readonly unknown[];
  assert.equal(blocks.length, 32);
  const overflow = parseJsonObject(parseJsonObject(blocks.at(-1))['data']);
  assert.equal((overflow['blocks'] as readonly unknown[]).length, 9);
  assert.equal(overflow['type'], 'content_overflow');
});
