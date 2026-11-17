import type { TrustedScope } from '../identity/scope.js';
import type { ConversationId, ModelCallId, RunId, StepId, ToolCallId } from '../identity/ids.js';
import type { ContentBlock } from '../messages/content.js';
import type { JsonObject } from '../messages/json.js';
import type { Message } from '../messages/message.js';
import type { ModelDecision } from './decision.js';
import type { ModelUsage } from './usage.js';

export interface ModelCapabilities {
  readonly toolCalling: boolean;
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly contentTypes: readonly ContentBlock['type'][];
}

/** Model-facing aliases are mapped to authorized MCP references by the application. */
export interface ModelToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
}

export interface ModelRequest {
  readonly scope: TrustedScope;
  readonly conversationId: ConversationId;
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly modelCallId: ModelCallId;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ModelToolDefinition[];
  readonly maxOutputTokens: number;
  readonly deadlineAt?: number;
  readonly responseSchema?: JsonObject;
}

export type ModelFailureCode = 'authentication_required' | 'permission' | 'rate_limited' | 'timeout'
  | 'transport' | 'invalid_response' | 'unsupported' | 'cancelled' | 'output_limit' | 'unknown';

export interface ModelFailure {
  readonly code: ModelFailureCode;
  readonly message: string;
  /** Transport guidance, never an instruction to retry an external side effect. */
  readonly retryable: boolean;
}

export type ModelResult =
  | { readonly ok: true; readonly decision: ModelDecision; readonly usage: ModelUsage }
  | { readonly ok: false; readonly error: ModelFailure; readonly usage: ModelUsage };

export type ModelStreamEvent =
  | { readonly type: 'text_delta'; readonly modelCallId: ModelCallId; readonly text: string }
  | { readonly type: 'tool_call_delta'; readonly modelCallId: ModelCallId; readonly toolCallId: ToolCallId; readonly argumentsDelta: string }
  | { readonly type: 'usage'; readonly modelCallId: ModelCallId; readonly usage: ModelUsage };

export interface ModelCallOptions {
  readonly signal?: AbortSignal;
  /** Await callbacks for backpressure. Deltas are provisional, never executable tool calls. */
  readonly onEvent?: (event: ModelStreamEvent) => void | Promise<void>;
}

export interface ModelGateway {
  readonly capabilities: ModelCapabilities;
  generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResult>;
}
