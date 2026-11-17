import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMcpToolResult } from '../../../src/adapters/mcp/errors/normalize.js';

test('wire metadata and annotations survive under host-private namespaces, never as model content', () => {
  const wire = {
    content: [
      { type: 'text', text: 'Data', annotations: { audience: ['user'] }, _meta: { display: 'private' } },
      { type: 'resource', resource: { uri: 'fixture://x', text: 'body', _meta: { custom: true } } },
      { type: 'resource_link', uri: 'fixture://link', name: 'Link' },
      { type: 'audio', mimeType: 'audio/wav', data: 'eA==' },
    ],
    _meta: { uiOnly: 'private' }, contentMetadata: 'server-field-must-not-collide',
  };
  const result = normalizeMcpToolResult(wire);
  assert.equal(result.status, 'success');
  assert.equal(result.content.length, 4);
  assert.deepEqual(result.content[0], { type: 'text', text: 'Data' });
  const envelope = result.privateMeta?.['envelope'];
  assert.deepEqual(envelope, { _meta: { uiOnly: 'private' }, contentMetadata: 'server-field-must-not-collide' });
  assert.ok(Array.isArray(result.privateMeta?.['content']));
});

test('malformed/cyclic/deep or executable input becomes uncertain without getter execution', () => {
  const cyclic: Record<string, unknown> = { content: [] };
  cyclic['self'] = cyclic;
  let invoked = false;
  const getter = Object.defineProperty({}, 'content', { enumerable: true, get: () => { invoked = true; return []; } });
  let deep: unknown = {};
  for (let index = 0; index < 40; index++) deep = { error: deep };
  for (const value of [null, {}, { content: null }, { content: [], isError: 'true' }, cyclic, getter, { content: [], structuredContent: deep }]) {
    const result = normalizeMcpToolResult(value);
    assert.equal(result.status, 'unknown');
  }
  assert.equal(invoked, false);
});

test('invalid media or unknown content types never become an empty successful response', () => {
  for (const content of [[{ type: 'future-unsupported' }], [{ type: 'image', mimeType: 'image/png', data: 'invalid' }]]) {
    const result = normalizeMcpToolResult({ content });
    assert.equal(result.status, 'unknown');
  }
  assert.deepEqual(normalizeMcpToolResult({ content: [] }), { status: 'success', content: [] });
});

test('returned data is detached and frozen rather than exposing mutable transport objects', () => {
  const input = { content: [{ type: 'text', text: 'before' }], structuredContent: { value: 1 }, _meta: { hint: 'before' } };
  const result = normalizeMcpToolResult(input);
  input.content[0]!.text = 'after';
  input.structuredContent.value = 9;
  assert.deepEqual(result.content[0], { type: 'text', text: 'before' });
  assert.deepEqual(result.structuredContent, { value: 1 });
  assert.equal(Object.isFrozen(result.structuredContent), true);
});

test('single JSON-text object can supplement absent structured content with explicit provenance', () => {
  const text = '{"stock":5}';
  const result = normalizeMcpToolResult({ content: [{ type: 'text', text }] });
  assert.deepEqual(result.structuredContent, { stock: 5 });
  assert.deepEqual(result.content, [{ type: 'text', text }]);
  assert.deepEqual(result.privateMeta?.['normalization'], { structuredContentSource: 'json_text' });
  const explicit = normalizeMcpToolResult({ content: [{ type: 'text', text }], structuredContent: {} });
  assert.deepEqual(explicit.structuredContent, {});
  const multiple = normalizeMcpToolResult({ content: [{ type: 'text', text }, { type: 'text', text: '{"stock":9}' }] });
  assert.equal(multiple.structuredContent, undefined);
  assert.equal(multiple.content.length, 2);
});
