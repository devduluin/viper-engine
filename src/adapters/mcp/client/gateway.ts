import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Clock } from '../../../contracts/identity/ports.js';
import { sameScope } from '../../../contracts/identity/scope.js';
import type { McpCapabilities, McpFeature } from '../../../contracts/mcp/capabilities.js';
import { supportsMcpFeature } from '../../../contracts/mcp/capabilities.js';
import type { McpPage, McpPromptDefinition, McpResourceDefinition, McpToolDefinition } from '../../../contracts/mcp/catalog.js';
import type { McpPromptResult, McpResourceContents } from '../../../contracts/mcp/content.js';
import type {
  McpCallOptions, McpGateway, McpListRequest, McpPromptGetRequest, McpResourceReadRequest, McpToolCallRequest,
} from '../../../contracts/mcp/gateway.js';
import type { McpContext } from '../../../contracts/mcp/identity.js';
import { assertMcpContext, mcpToolKey } from '../../../contracts/mcp/identity.js';
import type { McpFailureCode, McpOperationResult, McpToolOutcome } from '../../../contracts/mcp/outcome.js';
import { assertMcpToolCall } from '../../../contracts/mcp/request-validation.js';
import { normalizedFailure } from '../errors/classify.js';
import { normalizeMcpToolResult } from '../errors/normalize.js';
import type { McpToolCatalog } from './catalog.js';
import { afterDispatch, httpRefusal, McpAdmissionError, notDispatched, operationFailure } from './failures.js';
import { listPrompts, listResources, getPrompt, readResource } from './context-reads.js';
import type { McpSession } from './session.js';
import { snapshotContext, snapshotToolRequest } from './snapshot.js';
import { timedMcp, timingFailure } from './timing.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';

export interface SdkGatewayOptions {
  readonly authorize?: () => Promise<void>;
  readonly clock: Clock;
  readonly requestTimeoutMs: number;
}

/**
 * McpGateway over one initialized SDK session owned by one scope and connection.
 * Every operation rechecks owner, connection, liveness, capability and deadline.
 */
export class SdkMcpGateway implements McpGateway {
  constructor(
    private readonly owner: McpContext,
    private readonly session: McpSession,
    private readonly catalog: McpToolCatalog,
    private readonly options: SdkGatewayOptions,
  ) {
    this.owner = snapshotContext(owner);
    this.options = Object.freeze({ ...options });
    assertTimerDuration('MCP request timeout', options.requestTimeoutMs);
    if (options.requestTimeoutMs === 0) throw new RangeError('MCP request timeout must be positive');
  }

  async getCapabilities(context: McpContext, options: McpCallOptions = {}): Promise<McpOperationResult<McpCapabilities>> {
    return this.read(context, undefined, options, async () => this.session.capabilities);
  }

  async listTools(request: McpListRequest, options: McpCallOptions = {}): Promise<McpOperationResult<McpPage<McpToolDefinition>>> {
    const blocked = this.blocked(request, 'tools', options);
    if (blocked !== undefined) return { ok: false, error: normalizedFailure(blocked) };
    try {
      return { ok: true, value: await timedMcp(this.options.clock, this.options.requestTimeoutMs, options,
        async bounded => {
          await this.options.authorize?.();
          return this.catalog.page(request.cursor, bounded.signal);
        }) };
    } catch (error) {
      this.retireRejectedSession(error);
      return operationFailure(error, options.signal);
    }
  }

  /** Not-dispatched failures are `error`; only a sent request can become `unknown`. */
  async callTool(request: McpToolCallRequest, options: McpCallOptions = {}): Promise<McpToolOutcome> {
    try { request = snapshotToolRequest(request); } catch { return notDispatched('invalid_value'); }
    options = Object.freeze({ ...options });
    const blocked = this.blocked(request, 'tools', options) ?? this.invalidCall(request, options);
    if (blocked !== undefined) return notDispatched(blocked);
    let sent = false;
    try {
      return await timedMcp(this.options.clock, this.options.requestTimeoutMs, options, async bounded => {
        const revision = this.catalog.revision;
        const stale = await this.staleDefinition(request, bounded);
        if (stale !== undefined) return notDispatched(stale);
        await this.options.authorize?.();
        const recheck = this.blocked(request, 'tools', bounded);
        if (recheck !== undefined) return notDispatched(recheck);
        if (revision !== this.catalog.revision) return notDispatched('not_found');
        sent = true;
        const raw = await this.session.client.request({
          method: 'tools/call', params: { name: request.tool.name, arguments: request.arguments },
        }, CallToolResultSchema, this.requestOptions(bounded));
        return normalizeMcpToolResult(raw);
      });
    } catch (error) {
      this.retireRejectedSession(error);
      if (sent) return afterDispatch(error, options.signal);
      const failure = operationFailure(error, options.signal);
      return failure.ok ? notDispatched('unknown') : notDispatched(failure.error.code);
    }
  }

  async listResources(request: McpListRequest, options: McpCallOptions = {}): Promise<McpOperationResult<McpPage<McpResourceDefinition>>> {
    return this.read(request, 'resources', options, bounded => listResources(this.session, request.cursor, this.requestOptions(bounded)));
  }

  async readResource(request: McpResourceReadRequest, options: McpCallOptions = {}): Promise<McpOperationResult<readonly McpResourceContents[]>> {
    const uri = request.uri;
    return this.read(request, 'resources', options, bounded => readResource(this.session, uri, this.requestOptions(bounded), this.options.authorize));
  }

  async listPrompts(request: McpListRequest, options: McpCallOptions = {}): Promise<McpOperationResult<McpPage<McpPromptDefinition>>> {
    return this.read(request, 'prompts', options, bounded => listPrompts(this.session, request.cursor, this.requestOptions(bounded)));
  }

  async getPrompt(request: McpPromptGetRequest, options: McpCallOptions = {}): Promise<McpOperationResult<McpPromptResult>> {
    request = Object.freeze({ ...request, ...(request.arguments === undefined ? {} : { arguments: Object.freeze({ ...request.arguments }) }) });
    return this.read(request, 'prompts', options, bounded => getPrompt(this.session, request, this.requestOptions(bounded), this.options.authorize));
  }

  private async read<Value>(
    context: McpContext, feature: McpFeature | undefined, options: McpCallOptions, work: (bounded: McpCallOptions) => Promise<Value>,
  ): Promise<McpOperationResult<Value>> {
    const blocked = this.blocked(context, feature, options);
    if (blocked !== undefined) return { ok: false, error: normalizedFailure(blocked) };
    try {
      return { ok: true, value: await timedMcp(this.options.clock, this.options.requestTimeoutMs, options, async bounded => {
        await this.options.authorize?.();
        return work(bounded);
      }) };
    } catch (error) {
      this.retireRejectedSession(error);
      return operationFailure(error, options.signal);
    }
  }

  private blocked(context: McpContext, feature: McpFeature | undefined, options: McpCallOptions): McpFailureCode | undefined {
    const access = this.accessFailure(context);
    if (access !== undefined) return access;
    if (this.session.closed) return 'connection_unavailable';
    const timing = timingFailure(options, this.options.clock.now());
    if (timing !== undefined) return timing;
    return feature === undefined || supportsMcpFeature(this.session.capabilities, feature) ? undefined : 'unsupported';
  }

  private accessFailure(context: McpContext): McpFailureCode | undefined {
    try {
      assertMcpContext(context);
    } catch {
      return 'invalid_value';
    }
    const sameConnection = context.connection.id === this.owner.connection.id
      && context.connection.serverId === this.owner.connection.serverId;
    return sameScope(context.scope, this.owner.scope) && sameConnection ? undefined : 'permission';
  }

  private invalidCall(request: McpToolCallRequest, options: McpCallOptions): McpFailureCode | undefined {
    try {
      assertMcpToolCall(request, this.session.capabilities, this.options.clock.now(), options);
      return undefined;
    } catch {
      return 'invalid_value';
    }
  }

  /** The exact definition version must still be advertised; a changed tool is not dispatched. */
  private async staleDefinition(request: McpToolCallRequest, options: McpCallOptions): Promise<McpFailureCode | undefined> {
    try {
      const tools = await this.catalog.all(options.signal);
      const key = mcpToolKey(request.tool);
      return tools.some(tool => mcpToolKey(tool.ref) === key) ? undefined : 'not_found';
    } catch (error) {
      if (error instanceof McpAdmissionError || httpRefusal(error) !== undefined) throw error;
      return this.session.closed ? 'connection_unavailable' : 'transport';
    }
  }

  private retireRejectedSession(error: unknown): void {
    // A later acquire may resolve/refresh credentials; the failed tool is never retried here.
    const refusal = httpRefusal(error);
    if (refusal === 'authentication_required' || refusal === 'connection_unavailable') void this.session.close().catch(() => undefined);
  }

  private requestOptions(options: McpCallOptions): RequestOptions {
    const remaining = options.deadlineAt === undefined ? Infinity : options.deadlineAt - this.options.clock.now();
    return {
      timeout: Math.max(1, Math.min(this.options.requestTimeoutMs, remaining)),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
  }
}
