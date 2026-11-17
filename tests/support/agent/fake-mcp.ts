import type { Clock } from '../../../src/contracts/identity/ports.js';
import { assertSameScope } from '../../../src/contracts/identity/scope.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import type { JsonObject } from '../../../src/contracts/messages/json.js';
import type { McpCapabilities, McpFeature } from '../../../src/contracts/mcp/capabilities.js';
import type { McpContext } from '../../../src/contracts/mcp/identity.js';
import { assertMcpContext, mcpToolKey } from '../../../src/contracts/mcp/identity.js';
import type {
  McpGateway, McpCallOptions, McpListRequest, McpToolCallRequest,
  McpResourceReadRequest, McpPromptGetRequest,
} from '../../../src/contracts/mcp/gateway.js';
import { assertMcpCallOptions, assertMcpOperation, assertMcpToolCall } from '../../../src/contracts/mcp/request-validation.js';
import { parseMcpContents, parseMcpResourceContents } from '../../../src/contracts/mcp/parse-content.js';
import { normalizeMcpToolResult } from '../../../src/adapters/mcp/errors/normalize.js';
import { fixtureItems, fixturePrompt, fixtureResource, fixtureTool } from './mcp-catalog.js';

export interface FixtureMcpTransport {
  request(method: string, params?: JsonObject): unknown;
}

/** Typed bridge to the existing P00 canned MCP service; no protocol SDK or remote transport. */
export class FakeMcpGateway implements McpGateway {
  constructor(
    private readonly owner: McpContext,
    private readonly transport: FixtureMcpTransport,
    private readonly clock: Clock,
    private readonly capabilities: McpCapabilities = {
      protocolVersion: 'fixture-only', tools: {}, resources: {}, prompts: {},
    },
  ) { assertMcpContext(owner); }

  async getCapabilities(context: McpContext, options: McpCallOptions = {}) {
    this.assertOwner(context);
    assertMcpCallOptions(options, this.clock.now());
    return { ok: true as const, value: this.capabilities };
  }

  async listTools(request: McpListRequest, options: McpCallOptions = {}) {
    this.preflight(request, 'tools', options);
    this.assertFirstPage(request);
    const items = fixtureItems(this.transport.request('tools/list'), 'tools');
    return { ok: true as const, value: { items: items.map(item => fixtureTool(item, request.connection)) } };
  }

  async callTool(request: McpToolCallRequest, options: McpCallOptions = {}) {
    this.assertOwner(request);
    assertMcpToolCall(request, this.capabilities, this.clock.now(), options);
    const catalog = await this.listTools(request, options);
    if (!catalog.value.items.some(tool => mcpToolKey(tool.ref) === mcpToolKey(request.tool))) {
      throw new Error('Unknown fixture tool or stale definition version');
    }
    // Recheck after the await, immediately before invoking the fixture service.
    this.preflight(request, 'tools', options);
    return normalizeMcpToolResult(this.transport.request('tools/call', {
      name: request.tool.name, arguments: request.arguments,
    }));
  }

  async listResources(request: McpListRequest, options: McpCallOptions = {}) {
    this.preflight(request, 'resources', options);
    this.assertFirstPage(request);
    const items = fixtureItems(this.transport.request('resources/list'), 'resources');
    return { ok: true as const, value: { items: items.map(fixtureResource) } };
  }

  async readResource(request: McpResourceReadRequest, options: McpCallOptions = {}) {
    this.preflight(request, 'resources', options);
    const items = fixtureItems(this.transport.request('resources/read', { uri: request.uri }), 'contents');
    return { ok: true as const, value: Object.freeze(items.map(parseMcpResourceContents)) };
  }

  async listPrompts(request: McpListRequest, options: McpCallOptions = {}) {
    this.preflight(request, 'prompts', options);
    this.assertFirstPage(request);
    const items = fixtureItems(this.transport.request('prompts/list'), 'prompts');
    return { ok: true as const, value: { items: items.map(fixturePrompt) } };
  }

  async getPrompt(request: McpPromptGetRequest, options: McpCallOptions = {}) {
    this.preflight(request, 'prompts', options);
    const payload = parseJsonObject(this.transport.request('prompts/get', {
      name: request.name, ...(request.arguments === undefined ? {} : { arguments: request.arguments }),
    }));
    const messages = fixtureItems(payload, 'messages').map(item => {
      const role = item['role'];
      if (role !== 'user' && role !== 'assistant') throw new Error('Invalid fixture prompt role');
      // P00 prompt fixtures use a singleton content block; the port always exposes an array.
      const blocks = Array.isArray(item['content']) ? item['content'] : [item['content']];
      return Object.freeze({ role, content: parseMcpContents(blocks) });
    });
    return { ok: true as const, value: { messages: Object.freeze(messages) } };
  }

  private assertOwner(context: McpContext): void {
    assertMcpContext(context);
    assertSameScope(this.owner.scope, context.scope);
    if (context.connection.id !== this.owner.connection.id || context.connection.serverId !== this.owner.connection.serverId) {
      throw new Error('Fixture connection access denied');
    }
  }

  private preflight(context: McpContext, feature: McpFeature, options: McpCallOptions): void {
    this.assertOwner(context);
    assertMcpOperation(context, this.capabilities, feature, this.clock.now(), options);
  }

  private assertFirstPage(request: McpListRequest): void {
    if (request.cursor !== undefined) throw new Error('Fixture pagination unsupported');
  }
}
