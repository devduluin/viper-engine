import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness, run, callsOf, finalText, runtimeTool, StubMcp, success } from '../runtime/harness.js';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';

test('search loads selected schemas without MCP dispatch or canonical history pollution', async () => {
  const mcp = new StubMcp(() => success({ done: true }));
  const h = harness([callsOf(['search-1', TOOL_SEARCH_NAME, { query: 'journal' }]),
    callsOf(['write-1', 'margin__journal', { amount: 7 }]), finalText('Done')], mcp,
  { input: { tools: [runtimeTool('margin__journal'), runtimeTool('workin__payroll')], toolDiscovery: { mode: 'on' } } });
  const result = await run(h);
  assert.equal(result.status, 'completed'); assert.equal(result.modelCalls, 3);
  assert.equal(mcp.calls.length, 1); assert.equal(result.budget.toolCalls, 1);
  assert.deepEqual(h.model.requests[0]?.tools.map(tool => tool.name), [TOOL_SEARCH_NAME]);
  assert.deepEqual(h.model.requests[1]?.tools.map(tool => tool.name), [TOOL_SEARCH_NAME, 'margin__journal']);
  assert.ok(h.model.requests[1]?.messages.some(message => message.role === 'tool' && message.toolCallId === 'search-1'));
  assert.ok(!result.messages.some(message => message.role === 'tool' && message.toolCallId === 'search-1'));
  assert.ok(h.events.some(event => event.type === 'tools_discovered'));
});
test('hidden calls cannot execute and mixed discovery/business batches are refused', async () => {
  const frames = [callsOf(['hidden', 'save']), callsOf(['search', TOOL_SEARCH_NAME, { query: 'save' }], ['write', 'save'])];
  for (const [index, frame] of frames.entries()) {
    const mcp = new StubMcp(() => success({})); const h = harness([frame, finalText('End')], mcp, { input: { toolDiscovery: { mode: 'on' } } });
    const result = await run(h); assert.equal(mcp.calls.length, 0);
    if (index === 0) assert.equal(result.toolCalls[0]?.status, 'rejected');
    else assert.equal(result.reason, 'invalid_model_response');
  }
});
test('control call IDs cannot be reused as business call IDs', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = harness([callsOf(['same', TOOL_SEARCH_NAME, { query: 'save' }]), callsOf(['same', 'save'])], mcp,
    { input: { toolDiscovery: { mode: 'on' }, maxModelCalls: 2 } });
  const result = await run(h); assert.equal(result.reason, 'invalid_model_response'); assert.equal(mcp.calls.length, 0);
});

test('excess discovery calls stop under a durable search ceiling without MCP side effects', async () => {
  const mcp = new StubMcp(() => success({}));
  const h = harness([callsOf(['search-1', TOOL_SEARCH_NAME, { query: 'missing' }]),
    callsOf(['search-2', TOOL_SEARCH_NAME, { query: 'save' }])], mcp, { input: { toolDiscovery: { mode: 'on', maxSearchCalls: 1 } } });
  const result = await run(h); assert.equal(result.reason, 'tool_search_limit'); assert.equal(result.modelCalls, 2);
  assert.equal(mcp.calls.length, 0);
});
