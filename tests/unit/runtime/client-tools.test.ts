import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMessageHistory } from '../../../src/contracts/messages/history.js';
import type { ClientToolCall, ClientToolPort } from '../../../src/agent/runtime/types.js';
import { callsOf, finalText, harness, run, StubMcp, success } from './harness.js';

const READ_PAGE = { name: 'client__read_page', description: 'Read the page the user has open', inputSchema: { type: 'object' } };

function port(answer: (call: ClientToolCall) => ReturnType<ClientToolPort['invoke']>, offered = [READ_PAGE]) {
  const calls: ClientToolCall[] = [];
  const clientTools: ClientToolPort = {
    definitions: async () => offered,
    invoke: async (call, _signal) => { calls.push(call); return answer(call); },
  };
  return { clientTools, calls };
}

test('client tools are offered to the model only when the run has them', async () => {
  const offered = harness([finalText('Hi')], new StubMcp(() => assert.fail('no MCP')), { deps: port(async () => ({ outcome: 'success', data: {} })) });
  await run(offered);
  assert.ok(offered.model.requests[0]?.tools.some(tool => tool.name === 'client__read_page'));
  const plain = harness([finalText('Hi')], new StubMcp(() => assert.fail('no MCP')));
  await run(plain);
  assert.ok(!plain.model.requests[0]?.tools.some(tool => tool.name.startsWith('client__')));
});

test('a client tool call runs in the client, never through MCP, and its result reaches the next model call', async () => {
  const mcp = new StubMcp(() => assert.fail('client tools are not MCP calls'));
  const { clientTools, calls } = port(async () => ({ outcome: 'success', data: { title: 'Daftar Karyawan', text: 'Ardi · Hadir' } }));
  const h = harness([callsOf(['p1', 'client__read_page', { focus: 'table' }]), finalText('Ardi hadir.')], mcp, { deps: { clientTools } });
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.map(call => [call.toolCallId, call.name, call.arguments]), [['p1', 'read_page', { focus: 'table' }]]);
  const evidence = h.model.requests[1]?.messages.at(-1);
  assert.ok(evidence?.role === 'tool' && evidence.toolCallId === 'p1' && evidence.outcome === 'success');
  assert.deepEqual(evidence.content, [{ type: 'json', data: { title: 'Daftar Karyawan', text: 'Ardi · Hadir' } }]);
  assert.ok(h.events.some(event => event.type === 'client_tools_completed'));
  assert.ok(!h.events.some(event => event.type === 'message_appended' && event.message.role === 'assistant' && event.decision === 'tool_calls'),
    'no MCP proposals for a client step');
  assertMessageHistory([...h.input.history.messages, ...result.messages], { allowPendingToolCalls: false });
});

test('MCP calls mixed into a client step are answered with an error and never dispatched; the run continues', async () => {
  const mcp = new StubMcp(request => success({ name: request.tool.name }));
  const { clientTools } = port(async () => ({ outcome: 'success', data: { title: 'x' } }));
  const h = harness([callsOf(['p1', 'client__read_page'], ['m1', 'lookup']), callsOf(['m2', 'lookup']), finalText('ok')], mcp, { deps: { clientTools } });
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['m2']);
  const second = h.model.requests[1]?.messages ?? [];
  const mixed = second.find(message => message.role === 'tool' && message.toolCallId === 'm1');
  assert.ok(mixed?.role === 'tool' && mixed.outcome === 'error');
});

test('a client that cannot answer yields an error result, not a failed run; unknown client tools are refused', async () => {
  const { clientTools } = port(async () => ({ outcome: 'error', message: 'Page not available' }));
  const h = harness([callsOf(['p1', 'client__read_page']), callsOf(['p2', 'client__click']), finalText('Maaf, halaman tidak bisa dibaca.')],
    new StubMcp(() => assert.fail('no MCP')), { deps: { clientTools } });
  const result = await run(h);
  assert.equal(result.status, 'completed');
  const results = result.messages.filter(message => message.role === 'tool');
  assert.deepEqual(results.map(message => message.role === 'tool' ? [message.toolCallId, message.outcome] : []), [['p1', 'error'], ['p2', 'error']]);
});
