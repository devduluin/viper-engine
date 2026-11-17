import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtures } from '../../../evals/lib/fixtures.mjs';
import { FakeMcp } from '../../../evals/support/fake-mcp.mjs';
import { parseId } from '../../../src/contracts/identity/ids.ts';
import { FakeMcpGateway } from '../../support/agent/fake-mcp.ts';
import { TestClock } from '../../support/agent/identity.ts';
import { testConnection, testContext, testScope } from '../../support/agent/setup.ts';

function setup(capabilities) {
  const { scope, runId } = testContext();
  const context = { scope, connection: testConnection() };
  const clock = new TestClock();
  const service = new FakeMcp(process.cwd(), loadFixtures(process.cwd()).catalog);
  const gateway = new FakeMcpGateway(context, service, clock, capabilities);
  const tool = { connectionId: context.connection.id, serverId: context.connection.serverId,
    name: 'lookup_item', definitionVersion: 'fixture-v1' };
  const request = { ...context, runId, toolCallId: parseId('tool_call', 'call-a'), tool, arguments: { id: 'item-1' } };
  return { context, clock, service, gateway, request };
}

test('P00 service bridge preserves success, isError and input-schema rejection', async () => {
  const { gateway, request } = setup();
  const success = await gateway.callTool(request);
  assert.equal(success.status, 'success');
  assert.deepEqual(success.structuredContent, { id: 'item-1', stock: 5 });
  const missing = await gateway.callTool({ ...request, arguments: { id: 'missing' } });
  assert.equal(missing.status, 'error');
  assert.equal(missing.error.code, 'not_found');
  await assert.rejects(gateway.callTool({ ...request, arguments: {} }), /tool arguments/);
});

test('wrong scope, connection, version, abort or expired deadline invokes no tool', async () => {
  const { gateway, request, service, clock } = setup();
  await assert.rejects(gateway.callTool({ ...request, scope: testScope('other') }), /Scope access denied/);
  await assert.rejects(gateway.callTool({ ...request, connection: { ...request.connection, id: parseId('mcp_connection', 'other') } }), /access denied/);
  await assert.rejects(gateway.callTool({ ...request, tool: { ...request.tool, definitionVersion: 'stale' } }), /stale/);
  await assert.rejects(gateway.callTool(request, { signal: AbortSignal.abort(new Error('Stop')) }), /Stop/);
  await assert.rejects(gateway.callTool(request, { deadlineAt: clock.now() }), /deadline/);
  assert.equal(service.calls.filter(call => call.method === 'tools/call').length, 0);
});

test('abort during catalog await is checked again immediately before fixture dispatch', async () => {
  const { gateway, request, service } = setup();
  const controller = new AbortController();
  const original = service.request.bind(service);
  service.request = (method, params) => {
    const result = original(method, params);
    if (method === 'tools/list') controller.abort(new Error('Stop before dispatch'));
    return result;
  };
  await assert.rejects(gateway.callTool(request, { signal: controller.signal }), /Stop before dispatch/);
  assert.equal(service.calls.filter(call => call.method === 'tools/call').length, 0);
});

test('tools-only fixture rejects resources/prompts and unsupported pagination explicitly', async () => {
  const { gateway, context, service } = setup({ protocolVersion: 'fixture-only', tools: {} });
  assert.equal((await gateway.getCapabilities(context)).value.resources, undefined);
  await assert.rejects(gateway.listResources(context), /Unsupported MCP feature/);
  await assert.rejects(gateway.listPrompts(context), /Unsupported MCP feature/);
  await assert.rejects(gateway.listTools({ ...context, cursor: 'next' }), /pagination unsupported/);
  assert.equal(service.calls.length, 0);
});

test('resources/prompts stay application-controlled and retain MCP content semantics', async () => {
  const { gateway, context } = setup();
  assert.equal((await gateway.listResources(context)).value.items[0].uri, 'fixture://policy');
  assert.equal((await gateway.readResource({ ...context, uri: 'fixture://policy' })).value[0].text, 'Stock is a count, not a reservation.');
  assert.equal((await gateway.listPrompts(context)).value.items[0].name, 'summarize_item');
  const prompt = await gateway.getPrompt({ ...context, name: 'summarize_item', arguments: { id: 'item-1' } });
  assert.deepEqual(prompt.value.messages, [{ role: 'user', content: [{ type: 'text', text: 'Summarize item-1 using available stock data.' }] }]);
});
