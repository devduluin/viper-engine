import type { Clock } from '../../../contracts/identity/ports.js';
import type { McpGateway, McpCallOptions, McpListRequest, McpPromptGetRequest, McpResourceReadRequest, McpToolCallRequest } from '../../../contracts/mcp/gateway.js';
import type { McpContext } from '../../../contracts/mcp/identity.js';
import type { McpOperationResult, McpToolOutcome } from '../../../contracts/mcp/outcome.js';
import type { McpConnectionPool } from './connection-pool.js';
import { snapshotContext, snapshotToolRequest } from './snapshot.js';
import { timedMcp, timingFailure } from './timing.js';
import { afterDispatch, McpAdmissionError, notDispatched, operationFailure } from './failures.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';

/** Routes each operation by its trusted scope/connection; no cached gateway bypass on resume. */
export class PooledMcpGateway implements McpGateway {
  private readonly operationTimeoutMs: number;

  constructor(private readonly pool: McpConnectionPool, private readonly clock: Clock, requestTimeoutMs: number, connectTimeoutMs = requestTimeoutMs) {
    assertTimerDuration('pooled MCP request timeout', requestTimeoutMs);
    assertTimerDuration('pooled MCP connect timeout', connectTimeoutMs);
    if (requestTimeoutMs === 0 || connectTimeoutMs === 0) throw new RangeError('Pooled MCP timeouts must be positive');
    this.operationTimeoutMs = requestTimeoutMs + connectTimeoutMs;
    assertTimerDuration('pooled MCP operation timeout', this.operationTimeoutMs);
  }

  async getCapabilities(context: McpContext, options: McpCallOptions = {}) {
    return this.read(context, options, (gateway, owner, bounded) => gateway.getCapabilities(owner, bounded));
  }

  async listTools(request: McpListRequest, options: McpCallOptions = {}) {
    const cursor = request.cursor;
    return this.read(request, options, (gateway, owner, bounded) => gateway.listTools({ ...owner, ...(cursor === undefined ? {} : { cursor }) }, bounded));
  }

  async listResources(request: McpListRequest, options: McpCallOptions = {}) {
    const cursor = request.cursor;
    return this.read(request, options, (gateway, owner, bounded) => gateway.listResources({ ...owner, ...(cursor === undefined ? {} : { cursor }) }, bounded));
  }

  async listPrompts(request: McpListRequest, options: McpCallOptions = {}) {
    const cursor = request.cursor;
    return this.read(request, options, (gateway, owner, bounded) => gateway.listPrompts({ ...owner, ...(cursor === undefined ? {} : { cursor }) }, bounded));
  }

  async readResource(request: McpResourceReadRequest, options: McpCallOptions = {}) {
    const uri = request.uri;
    return this.read(request, options, (gateway, owner, bounded) => gateway.readResource({ ...owner, uri }, bounded));
  }

  async getPrompt(request: McpPromptGetRequest, options: McpCallOptions = {}) {
    const name = request.name; const args = request.arguments === undefined ? undefined : Object.freeze({ ...request.arguments });
    return this.read(request, options, (gateway, owner, bounded) => gateway.getPrompt({ ...owner, name,
      ...(args === undefined ? {} : { arguments: args }) }, bounded));
  }

  async callTool(request: McpToolCallRequest, options: McpCallOptions = {}): Promise<McpToolOutcome> {
    try { request = snapshotToolRequest(request); } catch { return notDispatched('invalid_value'); }
    let handedOff = false;
    try {
      options = Object.freeze({ ...options });
      const initial = timingFailure(options, this.clock.now());
      if (initial !== undefined) return notDispatched(initial);
      return await timedMcp(this.clock, this.operationTimeoutMs, options, async bounded => {
        const gateway = await this.acquire(request);
        const blocked = timingFailure(bounded, this.clock.now());
        if (blocked !== undefined) return notDispatched(blocked);
        handedOff = true;
        return gateway.callTool(request, bounded);
      });
    } catch (error) {
      if (handedOff) return afterDispatch(error, options.signal);
      const failure = operationFailure(error, options.signal);
      return notDispatched(failure.ok ? 'unknown' : failure.error.code);
    }
  }

  private async acquire(context: McpContext): Promise<McpGateway> {
    const acquired = await this.pool.acquire(context.scope, context.connection.id);
    if (!acquired.ok) throw new McpAdmissionError(acquired.code === 'revoked' ? 'permission' : acquired.code);
    return acquired.connection.gateway;
  }

  private async read<Value>(context: McpContext, options: McpCallOptions,
    operation: (gateway: McpGateway, owner: McpContext, bounded: McpCallOptions) => Promise<McpOperationResult<Value>>): Promise<McpOperationResult<Value>> {
    try {
      options = Object.freeze({ ...options });
      const owner = snapshotContext(context);
      const blocked = timingFailure(options, this.clock.now());
      if (blocked !== undefined) throw new McpAdmissionError(blocked);
      return await timedMcp(this.clock, this.operationTimeoutMs, options, async bounded => {
        const gateway = await this.acquire(owner);
        return operation(gateway, owner, bounded);
      });
    } catch (error) { return operationFailure(error, options.signal); }
  }
}
