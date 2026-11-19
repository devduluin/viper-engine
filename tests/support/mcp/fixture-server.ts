import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema,
  ListToolsRequestSchema, McpError, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface FixtureOptions {
  readonly missingResource?: boolean;
  readonly onCall?: (name: string) => void;
  readonly onListTools?: () => void;
  readonly extraTools?: readonly Tool[];
  readonly handlers?: Readonly<Record<string, (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>>>;
  readonly toolsOnly?: boolean;
  /** Adds `env_probe`, which reports whether FIXTURE_TOKEN reached the server process. */
  readonly envProbe?: boolean;
  /** Called by the `crash` tool; stdio exits the process, HTTP closes the transport. */
  readonly crash?: () => void;
}

const object = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object' as const, properties, required });
const PAGE_SIZE = 2;

function baseTools(): Tool[] {
  return [
    { name: 'lookup_item', description: 'Get item stock', inputSchema: object({ id: { type: 'string' } }, ['id']),
      outputSchema: object({ id: { type: 'string' }, stock: { type: 'integer' } }, ['id', 'stock']), annotations: { readOnlyHint: true } },
    { name: 'add', description: 'Add numbers', inputSchema: object({ a: { type: 'number' }, b: { type: 'number' } }, ['a', 'b']) },
    { name: 'hang', description: 'Never answers', inputSchema: object({}) },
    { name: 'crash', description: 'Kills the server mid-call', inputSchema: object({}) },
    { name: 'grow', description: 'Changes the tool list', inputSchema: object({}) },
    { name: 'call_log', description: 'Names of tools/call requests received', inputSchema: object({}) },
    { name: 'weird.name/v2', description: 'Needs alias sanitizing', inputSchema: object({}) },
  ];
}

/** Same initial catalog used by the server and pinned by regression manifests. */
export function fixtureTools(options: FixtureOptions = {}): Tool[] {
  const tools = [...baseTools(), ...(options.extraTools ?? [])];
  if (options.envProbe === true) tools.push({ name: 'env_probe', description: 'Credential env check', inputSchema: object({}) });
  return tools;
}

function text(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(typeof value === 'object' && value !== null ? { structuredContent: value as Record<string, unknown> } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Deterministic MCP server for adapter contract tests (low-level SDK Server, raw JSON Schemas).
 * Not a production server and not a copy of any legacy tool.
 */
export function createFixtureServer(options: FixtureOptions = {}): Server {
  const tools = fixtureTools(options);
  const calls: string[] = [];
  const capabilities = options.toolsOnly === true
    ? { tools: { listChanged: true } }
    : { tools: { listChanged: true }, resources: {}, prompts: {} };
  const server = new Server({ name: 'viper-fixture', version: '1.0.0' }, { capabilities });

  server.setRequestHandler(ListToolsRequestSchema, request => {
    options.onListTools?.();
    const start = Number(request.params?.cursor ?? '0');
    const next = start + PAGE_SIZE;
    return { tools: tools.slice(start, next), ...(next < tools.length ? { nextCursor: String(next) } : {}) };
  });

  type Args = Record<string, unknown>;
  const never = () => new Promise<CallToolResult>(() => undefined);
  const handlers: Record<string, (args: Args) => CallToolResult | Promise<CallToolResult>> = {
    lookup_item: args => {
      if (typeof args['id'] !== 'string') throw new McpError(ErrorCode.InvalidParams, 'id is required');
      return args['id'] === 'missing' ? text({ code: 'not_found' }, true) : text({ id: args['id'], stock: 5 });
    },
    add: args => text({ sum: Number(args['a']) + Number(args['b']) }),
    hang: never,
    crash: () => { options.crash?.(); return never(); },
    grow: async () => {
      tools.push({ name: 'extra', description: 'Added later', inputSchema: object({}) });
      tools[0] = { ...tools[0]!, description: 'Get item stock (v2)' };
      await server.sendToolListChanged();
      return text({ grown: true });
    },
    call_log: () => text({ calls: [...calls] }),
    env_probe: () => text({ token: process.env['FIXTURE_TOKEN'] ?? null, path: process.env['VIPER_SECRET_LEAK'] ?? null }),
    ...(options.handlers ?? {}),
  };

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name } = request.params;
    calls.push(name);
    options.onCall?.(name);
    const handler = tools.some(tool => tool.name === name) ? handlers[name] : undefined;
    if (handler === undefined) throw new McpError(ErrorCode.InvalidParams, `Unknown tool ${name}`);
    return handler(request.params.arguments ?? {});
  });

  if (options.toolsOnly !== true) registerContext(server, options.missingResource);
  return server;
}

function registerContext(server: Server, missing = false): void {
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{ uri: 'fixture://policy', name: 'Fixture policy', mimeType: 'text/plain', _meta: { hidden: true } }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, request => {
    if (missing) throw new McpError(-32002, 'PRIVATE resource diagnostic');
    if (request.params.uri !== 'fixture://policy') throw new McpError(ErrorCode.InvalidParams, 'Unknown resource');
    return { contents: [{ uri: 'fixture://policy', mimeType: 'text/plain', text: 'Stock count does not reserve an item' }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{ name: 'summarize_item', description: 'Summarize', arguments: [{ name: 'id', required: true }] }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, request => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Summarize ${request.params.arguments?.['id'] ?? '?'}` } }],
  }));
}
