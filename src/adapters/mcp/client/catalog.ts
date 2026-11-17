import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { JsonObject } from '../../../contracts/messages/json.js';
import type { McpPage, McpToolAnnotations, McpToolDefinition } from '../../../contracts/mcp/catalog.js';
import type { McpConnectionRef } from '../../../contracts/mcp/identity.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';
import type { McpSession } from './session.js';

export interface CatalogOptions {
  readonly authorize?: () => Promise<void>;
  readonly requestTimeoutMs: number;
  /** Upper bound on tools/list pages, so a misbehaving server cannot loop forever. */
  readonly maxPages?: number;
}

const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

function json(value: unknown): JsonObject {
  return parseJsonObject(JSON.parse(JSON.stringify(value)));
}

function annotationsOf(tool: Tool): McpToolAnnotations | undefined {
  const source = tool.annotations;
  if (source === undefined) return undefined;
  const entries = ANNOTATION_KEYS.filter(key => typeof source[key] === 'boolean').map(key => [key, source[key]]);
  return entries.length === 0 ? undefined : Object.freeze(Object.fromEntries(entries));
}

/**
 * Normalizes one advertised tool. `definitionVersion` is a fingerprint of everything the model
 * or policy sees, so any definition change yields a new version and invalidates approvals.
 */
export function toolDefinition(tool: Tool, connection: McpConnectionRef): McpToolDefinition {
  if (typeof tool.name !== 'string' || tool.name.trim().length === 0) throw new Error('MCP tool without a name');
  const inputSchema = json(tool.inputSchema);
  if (inputSchema['type'] !== 'object') throw new Error(`MCP tool ${tool.name} input schema must be an object schema`);
  const outputSchema = tool.outputSchema === undefined ? undefined : json(tool.outputSchema);
  const annotations = annotationsOf(tool);
  const visible = { name: tool.name, ...optionalFields(tool, outputSchema, annotations), inputSchema };
  const definitionVersion = createFingerprint(visible, { domain: 'viper.mcp.tool_definition', version: '1' });
  return Object.freeze({
    ref: Object.freeze({ connectionId: connection.id, serverId: connection.serverId, name: tool.name, definitionVersion }),
    inputSchema, ...optionalFields(tool, outputSchema, annotations),
  });
}

function optionalFields(tool: Tool, outputSchema: JsonObject | undefined, annotations: McpToolAnnotations | undefined) {
  return {
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(annotations === undefined ? {} : { annotations }),
  };
}

/**
 * Discovered tool catalog of one session. The snapshot is dropped on tools/list_changed and on
 * disconnect; a load that races with an invalidation is discarded instead of cached.
 */
export class McpToolCatalog {
  private snapshot: Promise<readonly McpToolDefinition[]> | undefined;
  private generation = 0;

  constructor(
    private readonly session: McpSession,
    private readonly connection: McpConnectionRef,
    private readonly options: CatalogOptions,
  ) {
    session.onInvalidate(() => this.invalidate());
  }

  invalidate(): void {
    this.generation += 1;
    this.snapshot = undefined;
  }

  get revision(): number { return this.generation; }

  async page(cursor?: string, signal?: AbortSignal): Promise<McpPage<McpToolDefinition>> {
    await this.options.authorize?.();
    if (this.session.closed) throw new Error('MCP session is closed');
    const result = await this.session.client.listTools(cursor === undefined ? {} : { cursor }, {
      timeout: this.options.requestTimeoutMs, ...(signal === undefined ? {} : { signal }),
    });
    const items = Object.freeze(result.tools.map(tool => toolDefinition(tool, this.connection)));
    return Object.freeze(result.nextCursor === undefined ? { items } : { items, nextCursor: result.nextCursor });
  }

  /**
   * Full catalog across pages; duplicate names, cursor loops and page overruns are errors.
   * If an invalidation lands while loading, the result is discarded and loaded again.
   */
  async all(signal?: AbortSignal): Promise<readonly McpToolDefinition[]> {
    await this.options.authorize?.();
    if (this.session.closed) throw new Error('MCP session is closed');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = this.generation;
      const pending = this.snapshot ?? this.load(signal);
      this.snapshot = pending;
      try {
        const tools = await pending;
        if (generation === this.generation) return tools;
      } catch (error) {
        if (this.snapshot === pending) this.snapshot = undefined;
        throw error;
      }
    }
    throw new Error('MCP tool catalog kept changing while loading');
  }

  private async load(signal?: AbortSignal): Promise<readonly McpToolDefinition[]> {
    const maxPages = this.options.maxPages ?? 20;
    const tools: McpToolDefinition[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.page(cursor, signal);
      tools.push(...page.items);
      if (page.nextCursor === undefined) return assertUniqueNames(tools);
      if (cursors.has(page.nextCursor)) throw new Error('MCP tools/list repeated a cursor');
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error(`MCP tools/list exceeded ${maxPages} pages`);
  }
}

function assertUniqueNames(tools: readonly McpToolDefinition[]): readonly McpToolDefinition[] {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.ref.name)) throw new Error(`MCP server listed tool ${tool.ref.name} twice`);
    names.add(tool.ref.name);
  }
  return Object.freeze([...tools]);
}
