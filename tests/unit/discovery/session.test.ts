import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';
import { callsOf, decided, finalText, runtimeTool, StubMcp, success } from '../runtime/harness.js';
import { accept, workflow } from '../workflow/fixtures.js';

test('approval refresh preserves selected schemas and refuses a subsequently guessed tool', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['s1', TOOL_SEARCH_NAME, { query: 'save' }]), callsOf(['c1', 'save']),
    callsOf(['c2', 'lookup']), finalText('Done')], mcp,
  { input: { tools: [runtimeTool('save'), runtimeTool('lookup')], toolDiscovery: { mode: 'on' } } });
  const session = await h.start();
  const accepted = await session.decideApproval(h.input.scope, accept(session.snapshot(h.input.scope)));
  const result = await session.resume(h.input.scope, accepted.revision);
  assert.equal(result.status, 'completed');
  assert.deepEqual(mcp.calls.map(call => call.toolCallId), ['c1']);
  assert.equal(result.toolCalls.find(call => call.id === 'c2')?.status, 'rejected');
  assert.deepEqual(h.model.requests[2]?.tools.map(tool => tool.name), [TOOL_SEARCH_NAME, 'save']);
  assert.ok(h.model.requests[2]?.messages.some(message => message.role === 'tool' && message.toolCallId === 's1'));
});

test('input refresh preserves search exchanges and refuses new catalog tools until discovery', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = workflow([callsOf(['s1', TOOL_SEARCH_NAME, { query: 'lookup' }]),
    decided({ kind: 'needs_input', question: 'Which item?' }), callsOf(['c1', 'hidden']), finalText('Done')], mcp,
  { input: { tools: [runtimeTool('lookup')], toolDiscovery: { mode: 'on' } },
    deps: { refreshTools: async () => [runtimeTool('lookup'), runtimeTool('hidden')] } });
  const session = await h.start();
  const view = session.snapshot(h.input.scope);
  const result = await session.submitInput(h.input.scope, { inputId: 'answer', expectedRevision: view.revision,
    content: [{ type: 'text', text: 'item-1' }] });
  assert.equal(result.status, 'completed'); assert.equal(mcp.calls.length, 0);
  assert.equal(result.toolCalls[0]?.status, 'rejected');
  assert.deepEqual(h.model.requests[2]?.tools.map(tool => tool.name), [TOOL_SEARCH_NAME, 'lookup']);
  assert.ok(h.model.requests[2]?.messages.some(message => message.role === 'tool' && message.toolCallId === 's1'));
});
