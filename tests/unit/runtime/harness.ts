import { parseId } from '../../../src/contracts/identity/ids.js';
import type { JsonObject } from '../../../src/contracts/messages/json.js';
import type { McpGateway, McpToolCallRequest } from '../../../src/contracts/mcp/gateway.js';
import type { McpToolOutcome } from '../../../src/contracts/mcp/outcome.js';
import { parseModelDecision } from '../../../src/contracts/models/decision.js';
import type { ModelResult } from '../../../src/contracts/models/gateway.js';
import type { ToolArgumentValidator, ToolCallPolicy } from '../../../src/agent/execution/plan-call.js';
import type { RuntimeTool } from '../../../src/agent/execution/tool-catalog.js';
import { runAgentLoop } from '../../../src/agent/runtime/run-loop.js';
import type { RunLoopDependencies, RunLoopInput, RuntimeEvent } from '../../../src/agent/runtime/types.js';
import { TestClock, TestIds } from '../../support/agent/identity.js';
import { ScriptedModel } from '../../support/agent/scripted-model.js';
import { testConnection, testContext } from '../../support/agent/setup.js';

export const USAGE = Object.freeze({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null } as const);

export function decided(decision: unknown): ModelResult {
  return { ok: true, decision: parseModelDecision(decision), usage: USAGE };
}

export function finalText(text: string): ModelResult {
  return decided({ kind: 'final', content: [{ type: 'text', text }] });
}

export function callsOf(...calls: readonly [id: string, name: string, args?: JsonObject][]): ModelResult {
  return decided({ kind: 'tool_calls', calls: calls.map(([id, name, args]) => ({ id, name, arguments: args ?? {} })) });
}

export function runtimeTool(alias: string, name = alias): RuntimeTool {
  const connection = testConnection();
  return {
    alias,
    context: { scope: testContext().scope, connection },
    definition: {
      ref: { connectionId: connection.id, serverId: connection.serverId, name, definitionVersion: 'v1' },
      inputSchema: { type: 'object' },
    },
  };
}

export function success(data: JsonObject): McpToolOutcome {
  return { status: 'success', content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

export function toolError(code: 'not_found' | 'invalid_value' = 'not_found'): McpToolOutcome {
  return { status: 'error', content: [], error: { code, message: `fixture ${code}`, retryable: false } };
}

type Handler = (request: McpToolCallRequest) => McpToolOutcome | Promise<McpToolOutcome>;

/** Records every callTool request; all other MCP operations are outside the loop's scope. */
export class StubMcp implements McpGateway {
  readonly calls: McpToolCallRequest[] = [];
  constructor(private readonly handler: Handler) {}
  async callTool(request: McpToolCallRequest) {
    this.calls.push(request);
    return this.handler(request);
  }
  getCapabilities(): never { throw new Error('not used'); }
  listTools(): never { throw new Error('not used'); }
  listResources(): never { throw new Error('not used'); }
  readResource(): never { throw new Error('not used'); }
  listPrompts(): never { throw new Error('not used'); }
  getPrompt(): never { throw new Error('not used'); }
}

export const acceptAll: ToolArgumentValidator = { validate: () => ({ ok: true }) };
export const executeAll: ToolCallPolicy = { decide: () => 'execute' };

export interface Harness {
  readonly input: RunLoopInput;
  readonly deps: RunLoopDependencies;
  readonly model: ScriptedModel;
  readonly events: RuntimeEvent[];
}

export function harness(
  frames: readonly ModelResult[], mcp: McpGateway,
  overrides: { input?: Partial<RunLoopInput>; deps?: Partial<RunLoopDependencies> } = {},
): Harness {
  const clock = new TestClock();
  const context = testContext();
  const model = new ScriptedModel(frames.map(result => ({ result })), clock);
  const events: RuntimeEvent[] = [];
  const input: RunLoopInput = {
    scope: context.scope, conversationId: context.conversationId, runId: parseId('run', 'run-a'),
    model: context.model, maxOutputTokens: context.maxOutputTokens, maxModelCalls: 8,
    history: context.history, instructions: context.instructions ?? [],
    tools: [runtimeTool('lookup'), runtimeTool('save')], ...overrides.input,
  };
  const deps: RunLoopDependencies = {
    model, mcp, clock, ids: new TestIds(), validator: acceptAll, policy: executeAll,
    onEvent: event => { events.push(event); }, ...overrides.deps,
  };
  return { input, deps, model, events };
}

export function run(h: Harness) {
  return runAgentLoop(h.input, h.deps);
}
