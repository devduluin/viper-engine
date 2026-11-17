import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMcpToolResult, normalizeMcpTransportFailure } from '../../../src/adapters/mcp/errors/normalize.js';
import { transportFailureCode } from '../../../src/adapters/mcp/errors/classify.js';
import type { McpFailureCode } from '../../../src/contracts/mcp/outcome.js';

test('trusted HTTP/OAuth/network evidence has explicit deterministic classification', () => {
  const cases: readonly (readonly [number, McpFailureCode])[] = [
    [400, 'invalid_value'], [401, 'authentication_required'], [403, 'permission'], [404, 'not_found'],
    [408, 'timeout'], [429, 'transient'], [500, 'transient'], [503, 'transient'], [501, 'unsupported'],
  ];
  for (const [httpStatus, expected] of cases) assert.equal(transportFailureCode({ httpStatus }), expected);
  assert.equal(transportFailureCode({ httpStatus: 400, oauthCode: 'invalid_grant' }), 'authentication_required');
  assert.equal(transportFailureCode({ oauthCode: 'insufficient_scope' }), 'permission');
  assert.equal(transportFailureCode({ networkCode: 'ETIMEDOUT' }), 'timeout');
  assert.equal(transportFailureCode({ networkCode: 'ECONNRESET' }), 'transient');
});

test('explicit transport auth failure cannot be erased by conflicting business payload hints', () => {
  const wire = { isError: true, structuredContent: { code: 'INVALID_VALUE' }, content: [{ type: 'text', text: '{"code":"TRANSIENT"}' }] };
  const result = normalizeMcpToolResult(wire, { httpStatus: 401 });
  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'authentication_required');
  const business = normalizeMcpToolResult({ isError: false, content: [], structuredContent: { status: 401, code: 'INVALID_TOKEN' } });
  assert.equal(business.status, 'success');
});

test('isError and exact structured codes drive errors; free prose and substrings do not', () => {
  for (const code of ['INVALID_TOKEN', 'permission_denied', 'missing_required', 'invalid_argument', 'wrong_scope', 'ambiguous_reference', 'not_found']) {
    const result = normalizeMcpToolResult({ isError: true, content: [], structuredContent: { error: { code } } });
    assert.equal(result.status, 'error');
    assert.notEqual(result.error.code, 'unknown');
  }
  for (const code of ['PREFIX_INVALID_TOKEN_SUFFIX', 'please INVALID_TOKEN now']) {
    const result = normalizeMcpToolResult({ isError: true, content: [{ type: 'text', text: 'Unauthorized! timeout 401' }], structuredContent: { message: 'INVALID_TOKEN', code } });
    if (result.status !== 'success') assert.equal(result.error.code, 'unknown');
  }
});

test('structured data wins over JSON-text hints without dropping either data or media', () => {
  const result = normalizeMcpToolResult({
    isError: true, structuredContent: { code: 'INVALID_VALUE', details: { count: 5 } },
    content: [{ type: 'text', text: '{"code":"INVALID_TOKEN"}' }, { type: 'image', mimeType: 'image/png', data: 'eA==' }],
  });
  if (result.status !== 'success') assert.equal(result.error.code, 'invalid_value');
  assert.equal(result.content.length, 2);
  assert.deepEqual(result.structuredContent?.['details'], { count: 5 });
});

test('JSON-text fallback is bounded and conflicting text codes remain unknown', () => {
  const single = normalizeMcpToolResult({ isError: true, content: [{ type: 'text', text: '{"error":{"code":"NOT_FOUND"}}' }] });
  if (single.status !== 'success') assert.equal(single.error.code, 'not_found');
  const conflict = normalizeMcpToolResult({ isError: true, content: [
    { type: 'text', text: '{"code":"NOT_FOUND"}' }, { type: 'text', text: '{"code":"INVALID_TOKEN"}' },
  ] });
  if (conflict.status !== 'success') assert.equal(conflict.error.code, 'unknown');
});

test('transport certainty is separate from retry hints and never assumes remote rollback', () => {
  for (const dispatchState of ['not_sent', 'sent', 'unknown'] as const) {
    const result = normalizeMcpTransportFailure({ dispatchState, evidence: { networkCode: 'ETIMEDOUT' } });
    assert.equal(result.status, dispatchState === 'not_sent' ? 'error' : 'unknown');
    assert.equal(result.error.retryable, true);
    assert.equal('retry' in result, false);
  }
});
