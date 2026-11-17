import assert from 'node:assert/strict';
import test from 'node:test';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { McpCapabilities } from '../../../src/contracts/mcp/capabilities.js';
import { supportsMcpFeature } from '../../../src/contracts/mcp/capabilities.js';
import type { McpGateway } from '../../../src/contracts/mcp/gateway.js';
import { assertMcpContext, mcpToolKey } from '../../../src/contracts/mcp/identity.js';
import type { McpContext } from '../../../src/contracts/mcp/identity.js';
import { parseMcpToolOutcome } from '../../../src/contracts/mcp/parse-outcome.js';
import { assertMcpOperation, assertMcpToolCall } from '../../../src/contracts/mcp/request-validation.js';
import { context, toolRequest } from './fixtures.js';

const toolsOnly: McpCapabilities = { protocolVersion: 'fixture-negotiated-version', tools: {} };

function fixtureGateway(dispatches: string[]): McpGateway {
  const unsupported = async () => ({
    ok: false as const, error: { code: 'unsupported' as const, message: 'Server does not advertise this feature', retryable: false },
  });
  return {
    async getCapabilities(request) {
      assertMcpContext(request);
      return { ok: true, value: toolsOnly };
    },
    async listTools(request, options) {
      assertMcpOperation(request, toolsOnly, 'tools', 0, options);
      return {
        ok: true, value: { items: [{ ref: toolRequest().tool, inputSchema: { type: 'object' } }], nextCursor: 'opaque-next' },
      };
    },
    async callTool(request, options) {
      assertMcpToolCall(request, toolsOnly, 0, options);
      dispatches.push(request.toolCallId);
      return parseMcpToolOutcome({ status: 'success', content: [], structuredContent: { stock: 5 } });
    },
    listResources: unsupported, readResource: unsupported,
    listPrompts: unsupported, getPrompt: unsupported,
  };
}

test('tools-only server is valid and unsupported resources/prompts return explicit failures', async () => {
  const gateway = fixtureGateway([]);
  const response = await gateway.getCapabilities(context());
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(supportsMcpFeature(response.value, 'tools'), true);
    assert.equal(supportsMcpFeature(response.value, 'resources'), false);
  }
  const tools = await gateway.listTools(context());
  if (tools.ok) assert.equal(tools.value.nextCursor, 'opaque-next');
  const resource = await gateway.readResource({ ...context(), uri: 'fixture://unavailable' });
  const prompt = await gateway.getPrompt({ ...context(), name: 'unavailable', arguments: { id: 'item-1' } });
  for (const result of [resource, prompt]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unsupported');
  }
});

test('tool keys isolate connections, servers and schema versions without delimiter collisions', () => {
  const ref = toolRequest().tool;
  const keys = [
    ref, { ...ref, connectionId: parseId('mcp_connection', 'connection-2') },
    { ...ref, serverId: parseId('mcp_server', 'server-2') }, { ...ref, definitionVersion: 'v2' },
    { ...ref, name: 'a/b', definitionVersion: 'c' }, { ...ref, name: 'a', definitionVersion: 'b/c' },
  ].map(mcpToolKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('wrong connection/server, untrusted context, abort and expired deadline prevent dispatch', async () => {
  const dispatches: string[] = [];
  const gateway = fixtureGateway(dispatches);
  const request = toolRequest();
  await assert.rejects(gateway.callTool({ ...request, tool: { ...request.tool, connectionId: parseId('mcp_connection', 'other') } }), /mismatch/);
  await assert.rejects(gateway.callTool({ ...request, tool: { ...request.tool, serverId: parseId('mcp_server', 'other') } }), /mismatch/);
  const forged = JSON.parse(JSON.stringify(context())) as McpContext;
  await assert.rejects(gateway.getCapabilities(forged), /server authentication/);
  const controller = new AbortController();
  controller.abort(new Error('stop before dispatch'));
  await assert.rejects(gateway.callTool(request, { signal: controller.signal }), /stop before dispatch/);
  await assert.rejects(gateway.callTool(request, { deadlineAt: 0 }), /deadline/);
  assert.deepEqual(dispatches, []);
});

test('resources/prompts and their typed results work independently of tools', async () => {
  const capabilities: McpCapabilities = { protocolVersion: 'fixture-version', resources: {}, prompts: {} };
  assert.doesNotThrow(() => assertMcpOperation(context(), capabilities, 'resources', 0));
  assert.doesNotThrow(() => assertMcpOperation(context(), capabilities, 'prompts', 0));
  assert.throws(() => assertMcpOperation(context(), capabilities, 'tools', 0), /Unsupported MCP feature/);
  const gateway: McpGateway = {
    ...fixtureGateway([]),
    getCapabilities: async () => ({ ok: true, value: capabilities }),
    listResources: async () => ({ ok: true, value: { items: [{ uri: 'fixture://policy', name: 'Policy' }] } }),
    readResource: async request => ({ ok: true, value: [{ uri: request.uri, text: 'Application-controlled context' }] }),
    listPrompts: async () => ({ ok: true, value: { items: [{ name: 'summarize', arguments: [{ name: 'id', required: true }] }] } }),
    getPrompt: async () => ({ ok: true, value: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Selected template' }] }] } }),
  };
  const resource = await gateway.readResource({ ...context(), uri: 'fixture://policy' });
  const prompt = await gateway.getPrompt({ ...context(), name: 'summarize', arguments: { id: 'item-1' } });
  if (resource.ok) assert.equal(resource.value[0]?.uri, 'fixture://policy');
  if (prompt.ok) assert.equal(prompt.value.messages[0]?.role, 'user');
});
