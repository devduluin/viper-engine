import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { parseToolCall } from '../../../src/contracts/messages/parse-message.js';
import { outcomeMessage } from '../../../src/agent/execution/result-message.js';
import { indexTools } from '../../../src/agent/execution/tool-catalog.js';
import { callsOf, finalText, harness, run, runtimeTool, StubMcp, success } from './harness.js';

test('dispatch intent is emitted before the MCP call, and a failing sink prevents dispatch', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const seen: number[] = [];
  const h = harness([callsOf(['c1', 'lookup']), finalText('ok')], mcp, { deps: { onEvent: event => {
    if (event.type === 'tool_call_dispatching') seen.push(mcp.calls.length);
  } } });
  await run(h);
  assert.deepEqual(seen, [0]);
  const blocked = new StubMcp(() => success({ ok: true }));
  const failing = harness([callsOf(['c1', 'lookup'])], blocked, { deps: { onEvent: event => {
    if (event.type === 'tool_call_dispatching') throw new Error('intent not persisted');
  } } });
  await assert.rejects(run(failing), /intent not persisted/);
  assert.equal(blocked.calls.length, 0);
});

test('a gateway fault after dispatch is unknown, never retried, and blocks completion', async () => {
  const mcp = new StubMcp(() => { throw new Error('socket closed after write'); });
  const h = harness([callsOf(['c1', 'save', { text: 'x' }]), finalText('Saved')], mcp);
  const result = await run(h);
  assert.equal(mcp.calls.length, 1);
  assert.deepEqual([result.status, result.reason], ['partial', 'unknown_outcome']);
  assert.equal(result.toolCalls[0]?.status, 'unknown');
  const message = result.messages[1];
  assert.ok(message?.role === 'tool' && message.outcome === 'unknown');
  assert.doesNotMatch(JSON.stringify(message.content), /socket closed/);
});

test('unknown aliases, invalid arguments and policy rejections are answered without dispatch', async () => {
  const mcp = new StubMcp(() => success({ ok: true }));
  const h = harness([
    callsOf(['c1', 'lookup_items', { id: 'a' }], ['c2', 'lookup', { bad: true }], ['c3', 'save', { text: 'x' }]),
    callsOf(['c4', 'lookup', { id: 'a' }]), finalText('ok'),
  ], mcp, { deps: {
    validator: { validate: (_schema, args) => args['bad'] === true ? { ok: false, message: 'id is required', field: 'id' } : { ok: true } },
    policy: { decide: tool => tool.alias === 'save' ? 'reject' : 'execute' },
  } });
  const result = await run(h);
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c4']);
  assert.deepEqual(result.toolCalls.map(call => [call.status, call.failureCode]), [
    ['rejected', 'not_found'], ['rejected', 'invalid_value'], ['rejected', 'permission'], ['succeeded', undefined],
  ]);
  assert.equal(result.status, 'completed');
  const feedback = h.model.requests[1]?.messages.filter(message => message.role === 'tool') ?? [];
  assert.deepEqual(feedback.map(message => message.role === 'tool' ? message.outcome : ''), ['error', 'error', 'error']);
  assert.match(JSON.stringify(feedback[1]?.content), /"field":"id"/);
});

test('approval anywhere in a batch holds every call; rejections are still answered', async () => {
  const mcp = new StubMcp(() => assert.fail('nothing may dispatch before approval'));
  const h = harness([callsOf(['c1', 'lookup'], ['c2', 'save', { text: 'x' }], ['c3', 'missing'])], mcp, { deps: {
    policy: { decide: tool => tool.alias === 'save' ? 'requires_approval' : 'execute' },
  } });
  const result = await run(h);
  assert.deepEqual([result.status, result.reason], ['waiting_for_approval', 'approval_required']);
  assert.deepEqual(result.toolCalls.map(call => call.status), ['deferred', 'awaiting_approval', 'rejected']);
  assert.deepEqual(result.messages.map(message => message.role), ['assistant', 'tool']);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: true });
  assert.throws(() => assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false }), /pending/);
});

test('cancellation stops further dispatch and answers undispatched calls so history stays paired', async () => {
  const controller = new AbortController();
  const mcp = new StubMcp(() => success({ ok: true }));
  const h = harness([callsOf(['c1', 'lookup'], ['c2', 'save'])], mcp, { input: { signal: controller.signal }, deps: {
    onEvent: event => { if (event.type === 'tool_call_reported') controller.abort(new Error('user cancelled')); },
  } });
  const result = await run(h);
  assert.equal(mcp.calls.length, 1);
  assert.deepEqual([result.status, result.reason], ['cancelled', 'cancelled']);
  assert.deepEqual(result.toolCalls.map(call => call.status), ['succeeded', 'cancelled']);
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
  const before = new AbortController();
  before.abort();
  const idle = harness([finalText('never')], mcp, { input: { signal: before.signal } });
  assert.equal((await run(idle)).modelCalls, 0);
});

test('tool index rejects ambiguous aliases and maps exact names only', () => {
  assert.throws(() => indexTools([runtimeTool('a'), runtimeTool('a', 'b')]), /Duplicate tool alias/);
  assert.throws(() => indexTools([runtimeTool('a', 'x'), runtimeTool('b', 'x')]), /two aliases/);
  assert.throws(() => indexTools([runtimeTool(' a')]), /Invalid tool alias/);
  const index = indexTools([runtimeTool('lookup')]);
  assert.equal(index.find('Lookup'), undefined);
  assert.deepEqual(index.modelTools.map(tool => tool.name), ['lookup']);
});

test('result mapping keeps content and structured data, never private metadata', () => {
  const call = parseToolCall({ id: 'c1', name: 'lookup', arguments: {} });
  const message = outcomeMessage(parseId('message', 'm1'), call, {
    status: 'success', privateMeta: { secret: 'token-123' }, structuredContent: { stock: 5 },
    content: [
      { type: 'image', mimeType: 'image/png', data: 'aGk=' },
      { type: 'resource_link', uri: 'fixture://a', name: 'A' },
      { type: 'resource', resource: { uri: 'fixture://b', blob: 'AAAA' } },
    ],
  });
  assert.doesNotMatch(JSON.stringify(message), /token-123|AAAA/);
  assert.deepEqual(message.content.map(block => block.type), ['image', 'json', 'json', 'json']);
  assert.deepEqual(message.content.at(-1), { type: 'json', data: { stock: 5 } });
});
