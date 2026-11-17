import type { RunId, ToolCallId } from '../identity/ids.js';
import type { JsonObject } from '../messages/json.js';
import type { McpCapabilities } from './capabilities.js';
import type { McpPage, McpPromptDefinition, McpResourceDefinition, McpToolDefinition } from './catalog.js';
import type { McpPromptResult, McpResourceContents } from './content.js';
import type { McpContext, McpToolRef } from './identity.js';
import type { McpOperationResult, McpToolOutcome } from './outcome.js';

export interface McpCallOptions {
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
}

export interface McpListRequest extends McpContext {
  readonly cursor?: string;
}

export interface McpToolCallRequest extends McpContext {
  readonly runId: RunId;
  readonly toolCallId: ToolCallId;
  readonly tool: McpToolRef;
  readonly arguments: JsonObject;
}

/** Application-controlled context read; this is not a model-approved generic URI fetch. */
export interface McpResourceReadRequest extends McpContext {
  readonly uri: string;
}

/** User/application-selected template; arguments follow MCP string parameter semantics. */
export interface McpPromptGetRequest extends McpContext {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, string>>;
}

/** Gateways must recheck connection ownership/availability at dispatch, including resume. */
export interface McpGateway {
  getCapabilities(context: McpContext, options?: McpCallOptions): Promise<McpOperationResult<McpCapabilities>>;
  listTools(request: McpListRequest, options?: McpCallOptions): Promise<McpOperationResult<McpPage<McpToolDefinition>>>;
  callTool(request: McpToolCallRequest, options?: McpCallOptions): Promise<McpToolOutcome>;
  listResources(request: McpListRequest, options?: McpCallOptions): Promise<McpOperationResult<McpPage<McpResourceDefinition>>>;
  readResource(request: McpResourceReadRequest, options?: McpCallOptions): Promise<McpOperationResult<readonly McpResourceContents[]>>;
  listPrompts(request: McpListRequest, options?: McpCallOptions): Promise<McpOperationResult<McpPage<McpPromptDefinition>>>;
  getPrompt(request: McpPromptGetRequest, options?: McpCallOptions): Promise<McpOperationResult<McpPromptResult>>;
}
