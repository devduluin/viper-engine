import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelDecision } from '../../../src/contracts/models/decision.js';
import { parseModelUsage } from '../../../src/contracts/models/usage.js';
import { assertModelCallOptions, assertModelRequest } from '../../../src/contracts/models/request-validation.js';
import { parseMessageHistory } from '../../../src/contracts/messages/history.js';
import type { TrustedScope } from '../../../src/contracts/identity/scope.js';
import { modelCapabilities, modelRequest } from './fixtures.js';

test('model decisions are normalized immutable proposals, never an approval grant', () => {
  const input = { kind: 'tool_calls', calls: [{ id: 'c1', name: 'lookup', arguments: { id: 'item-1' } }] };
  const decision = parseModelDecision(input);
  input.calls[0]!.arguments.id = 'changed';
  assert.equal(decision.kind, 'tool_calls');
  if (decision.kind === 'tool_calls') {
    assert.equal(decision.calls[0]?.arguments['id'], 'item-1');
    assert.deepEqual(decision.content, []);
    assert.equal(Object.isFrozen(decision.calls), true);
  }
  assert.throws(() => parseModelDecision({ kind: 'grant_approval' }), /decision/);
  assert.throws(() => parseModelDecision({ ...input, approvalPermit: 'invented' }), /Unexpected decision field/);
});

test('final, clarification and tool-call decisions reject incomplete or duplicate data', () => {
  assert.equal(parseModelDecision({ kind: 'final', content: [{ type: 'text', text: 'Done' }] }).kind, 'final');
  assert.deepEqual(parseModelDecision({ kind: 'needs_input', question: 'Which item?' }), { kind: 'needs_input', question: 'Which item?' });
  const call = { id: 'c1', name: 'lookup', arguments: {} };
  for (const value of [
    { kind: 'final', content: [] }, { kind: 'needs_input', question: ' ' },
    { kind: 'tool_calls', calls: [] }, { kind: 'tool_calls', calls: [call, call] },
    { kind: 'tool_calls', calls: [{ ...call, arguments: [] }] },
  ]) assert.throws(() => parseModelDecision(value));
});

test('usage distinguishes actual, estimated, zero and unavailable counts', () => {
  assert.deepEqual(parseModelUsage({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null }), {
    source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null,
  });
  assert.equal(parseModelUsage({ source: 'provider', inputTokens: 0, outputTokens: 0, totalTokens: 0 }).totalTokens, 0);
  assert.equal(parseModelUsage({ source: 'estimate', inputTokens: 5, outputTokens: null, totalTokens: null }).source, 'estimate');
  for (const count of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', undefined]) {
    assert.throws(() => parseModelUsage({ source: 'provider', inputTokens: count, outputTokens: null, totalTokens: null }));
  }
  assert.throws(() => parseModelUsage({ source: 'unavailable', inputTokens: 0, outputTokens: null, totalTokens: null }), /null counts/);
});

test('model request preflight enforces limits and negotiated content/tools/schema support', () => {
  const request = modelRequest();
  assert.doesNotThrow(() => assertModelRequest(request, modelCapabilities, 0));
  assert.throws(() => assertModelRequest({ ...request, maxOutputTokens: 0 }, modelCapabilities, 0), /token limit/);
  assert.throws(() => assertModelRequest(request, modelCapabilities, 1000), /deadline/);
  assert.throws(() => assertModelRequest(request, { ...modelCapabilities, toolCalling: false }, 0), /support tools/);
  assert.throws(() => assertModelRequest({ ...request, tools: [...request.tools, ...request.tools] }, modelCapabilities, 0), /unique/);
  assert.throws(() => assertModelRequest({ ...request, responseSchema: {} }, { ...modelCapabilities, structuredOutput: false }, 0), /structured output/);
  const image = parseMessageHistory([{ id: 'm1', role: 'user', content: [
    { type: 'image', source: { kind: 'inline', mediaType: 'image/png', encoding: 'base64', data: 'eA==' } },
  ] }]);
  assert.throws(() => assertModelRequest({ ...request, messages: image }, { ...modelCapabilities, contentTypes: ['text'] }, 0), /content type/);
});

test('model requests cannot bypass trusted scope or submit unresolved tool proposals', () => {
  const request = modelRequest();
  const forged = JSON.parse(JSON.stringify(request.scope)) as TrustedScope;
  assert.throws(() => assertModelRequest({ ...request, scope: forged }, modelCapabilities, 0), /server authentication/);
  const pending = parseMessageHistory([{ id: 'm1', role: 'assistant', content: [], toolCalls: [
    { id: 'c1', name: 'lookup', arguments: {} },
  ] }]);
  assert.throws(() => assertModelRequest({ ...request, messages: pending }, modelCapabilities, 0), /pending/);
});

test('abort and unsupported streaming are explicit before provider dispatch', () => {
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  assert.throws(() => assertModelCallOptions(modelCapabilities, { signal: controller.signal }), /caller cancelled/);
  assert.throws(() => assertModelCallOptions({ ...modelCapabilities, streaming: false }, { onEvent: () => {} }), /streaming/);
});
