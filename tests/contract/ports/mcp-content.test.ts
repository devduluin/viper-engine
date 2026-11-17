import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMcpContents, parseMcpResourceContents } from '../../../src/contracts/mcp/parse-content.js';
import { parseMcpFailure, parseMcpToolOutcome } from '../../../src/contracts/mcp/parse-outcome.js';

test('MCP content preserves text, image, audio, links and embedded text/binary resources', () => {
  const content = parseMcpContents([
    { type: 'text', text: '' }, { type: 'image', mimeType: 'image/png', data: 'eA==' },
    { type: 'audio', mimeType: 'audio/wav', data: 'eA==' },
    { type: 'resource_link', uri: 'fixture://document', name: 'Document', description: 'Reference only' },
    { type: 'resource', resource: { uri: 'fixture://text', mimeType: 'text/plain', text: 'Data' } },
    { type: 'resource', resource: { uri: 'fixture://binary', blob: '' } },
  ]);
  assert.equal(content.length, 6);
  assert.equal(content[3]?.type, 'resource_link');
  assert.deepEqual(content[5], { type: 'resource', resource: { uri: 'fixture://binary', blob: '' } });
  assert.equal(Object.isFrozen(content), true);
});

test('resource metadata is not fetched and malformed or ambiguous bodies fail closed', () => {
  assert.deepEqual(parseMcpResourceContents({ uri: 'fixture://empty', text: '' }), { uri: 'fixture://empty', text: '' });
  assert.deepEqual(parseMcpContents([{ type: 'resource_link', uri: 'fixture://x', name: 'x', description: '' }]), [
    { type: 'resource_link', uri: 'fixture://x', name: 'x', description: '' },
  ]);
  for (const body of [
    { uri: 'fixture://x' }, { uri: 'fixture://x', text: '', blob: '' },
    { uri: 'fixture://x', blob: 'invalid' }, { uri: '', text: 'value' },
  ]) assert.throws(() => parseMcpResourceContents(body));
  assert.throws(() => parseMcpContents([{ type: 'invented' }]), /Unsupported MCP content/);
  assert.throws(() => parseMcpContents([{ type: 'image', mimeType: 'image/png', data: 'bad' }]), /base64/);
});

test('structured data and every content block survive a normalized result without precedence loss', () => {
  const original = {
    status: 'success', content: [{ type: 'text', text: '{"stock":999}' }, { type: 'audio', mimeType: 'audio/wav', data: 'eA==' }],
    structuredContent: { stock: 5 }, privateMeta: { ui: 'host-only' },
  };
  const result = parseMcpToolOutcome(original);
  original.structuredContent.stock = 0;
  assert.equal(result.structuredContent?.['stock'], 5);
  assert.equal(result.content.length, 2);
  assert.equal(result.privateMeta?.['ui'], 'host-only');
  assert.equal(Object.isFrozen(result), true);
});

test('error/unknown outcome is explicit; retryability grants neither repeat execution nor success', () => {
  for (const status of ['error', 'unknown']) {
    const result = parseMcpToolOutcome({ status, content: [], error: { code: 'timeout', message: 'No confirmed response', retryable: true } });
    assert.equal(result.status, status);
    if (result.status !== 'success') assert.equal(result.error.retryable, true);
  }
  assert.deepEqual(parseMcpToolOutcome({ status: 'success', content: [] }), { status: 'success', content: [] });
  assert.throws(() => parseMcpToolOutcome({ status: 'success', content: [], error: { code: 'unknown', message: 'x', retryable: false } }), /cannot contain an error/);
  assert.throws(() => parseMcpToolOutcome({ status: 'unknown', content: [] }));
  assert.throws(() => parseMcpFailure({ code: 'approved', message: 'Run it', retryable: true }), /failure/);
});
