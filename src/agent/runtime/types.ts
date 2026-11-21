import type { ConversationId, ModelCallId, RunId, StepId } from '../../contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../../contracts/identity/ports.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { Message, ToolCall } from '../../contracts/messages/message.js';
import type { McpGateway } from '../../contracts/mcp/gateway.js';
import type { ModelFailure, ModelGateway, ModelToolDefinition } from '../../contracts/models/gateway.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { ModelUsage } from '../../contracts/models/usage.js';
import type { ScopedHistory } from '../context/assemble.js';
import type { ExecutionEvent, ToolCallReport } from '../execution/dispatch.js';
import type { CallRejection, ToolArgumentValidator, ToolCallPolicy } from '../execution/plan-call.js';
import type { RuntimeTool } from '../execution/tool-catalog.js';
import type { BudgetUsage } from '../policies/budget.js';
import type { BudgetState } from '../policies/budget-state.js';
import type { BudgetReason, RunLimits } from '../policies/limits.js';
import type { ContextBudget } from '../../contracts/context/budget.js';
import type { ContextCheckpoint } from '../../contracts/context/checkpoint.js';
import type { MessageId } from '../../contracts/identity/ids.js';
import type { ToolIndex } from '../execution/tool-catalog.js';
import type { RunBudget } from '../policies/budget.js';
import type { RunControl } from '../policies/control.js';
import type { ContextEvidenceProvider } from '../../contracts/context/evidence.js';
import type { ToolDiscoveryConfig } from '../../contracts/discovery/config.js';
import type { ToolDiscoveryState } from '../../contracts/discovery/state.js';
import type { ToolDiscovery } from '../discovery/controller.js';

export interface StepContext {
  readonly input: RunLoopInput; readonly deps: RunLoopDependencies; readonly index: ToolIndex;
  readonly state: LoopState; readonly emit: Emit; readonly budget: RunBudget; readonly control: RunControl;
  readonly discovery: ToolDiscovery;
}

export interface RunLoopInput {
  /** Trusted persisted execution state, validated by the application; never request JSON. */
  readonly resume?: { readonly budget: BudgetState; readonly modelCalls: number; readonly reports: readonly ToolCallReport[]; readonly contextCheckpoint?: ContextCheckpoint; readonly toolDiscovery?: ToolDiscoveryState };
  readonly toolDiscovery?: Partial<ToolDiscoveryConfig>;
  readonly context?: Partial<ContextBudget>;
  /** Earliest current-run message, supplied by trusted storage; no active work may be compressed. */
  readonly contextStartMessageId?: MessageId;
  readonly scope: TrustedScope;
  readonly conversationId: ConversationId;
  readonly runId: RunId;
  readonly model: string;
  readonly maxOutputTokens: number;
  /** Hard ceiling on model attempts; durable resume retains the accumulated counter. */
  readonly maxModelCalls: number;
  readonly limits?: Partial<RunLimits>;
  /** Trusted, scope-checked history loaded by the application. */
  readonly history: ScopedHistory;
  readonly instructions?: readonly Message[];
  readonly tools: readonly RuntimeTool[];
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
}

export type RunLoopStatus =
  | 'completed' | 'partial' | 'failed' | 'cancelled' | 'waiting_for_input' | 'waiting_for_approval';

export type RunStopReason =
  | 'final_answer' | 'tool_failures' | 'unknown_outcome' | 'needs_input' | 'approval_required'
  | 'model_failure' | 'invalid_model_response' | 'model_call_limit' | 'deadline_exceeded' | 'cancelled' | BudgetReason;

export type RuntimeEvent =
  | ExecutionEvent
  | { readonly type: 'tools_discovered'; readonly state: ToolDiscoveryState }
  /** Auxiliary browser/native tools: the assistant message and its results, journaled together. */
  | { readonly type: 'client_tools_completed'; readonly messages: readonly Message[] }
  | { readonly type: 'model_call_started'; readonly stepId: StepId; readonly modelCallId: ModelCallId; readonly contextCheckpoint?: ContextCheckpoint }
  | { readonly type: 'model_call_finished'; readonly modelCallId: ModelCallId; readonly ok: boolean; readonly usage: ModelUsage; readonly failureCode?: ModelFailure['code'] }
  | { readonly type: 'message_appended'; readonly message: Message; readonly decision?: 'final' | 'tool_calls' | 'needs_input' }
  | { readonly type: 'batch_finished' }
  | { readonly type: 'run_stopped'; readonly status: RunLoopStatus; readonly reason: RunStopReason };

export type ClientToolOutcome =
  | { readonly outcome: 'success'; readonly data: JsonObject }
  | { readonly outcome: 'error'; readonly message: string };

export interface ClientToolCall {
  readonly scope: TrustedScope; readonly conversationId: ConversationId; readonly runId: RunId;
  readonly toolCallId: string; readonly name: string; readonly arguments: JsonObject;
}

/** Host port for client tools. `invoke` must resolve (an error outcome) when the client cannot answer. */
export interface ClientToolPort {
  definitions(runId: RunId): Promise<readonly ModelToolDefinition[]>;
  invoke(call: ClientToolCall, signal: AbortSignal): Promise<ClientToolOutcome>;
}

export interface RunLoopDependencies {
  readonly userMemory?: Pick<import('../../contracts/recall/user-memory.js').UserMemoryPort, 'search'>;
  readonly contextEvidence?: ContextEvidenceProvider;
  /** Tools executed by the user's client (e.g. reading the open web page); absent = none offered. */
  readonly clientTools?: ClientToolPort;
  readonly model: ModelGateway;
  readonly mcp: McpGateway;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly validator: ToolArgumentValidator;
  readonly policy: ToolCallPolicy;
  /** Synchronous final admission after awaited intent, immediately before gateway invocation. */
  readonly beforeToolInvoke?: (tool: RuntimeTool, call: ToolCall) => CallRejection | undefined;
  /** Awaited in order. A throwing sink stops the loop; dispatch never starts before its intent event. */
  readonly onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

export interface RunStop {
  readonly status: RunLoopStatus;
  readonly reason: RunStopReason;
  readonly question?: string;
  readonly modelFailure?: ModelFailure;
}

export interface RunLoopResult extends RunStop {
  /** Messages appended during this invocation, in order. */
  readonly messages: readonly Message[];
  readonly toolCalls: readonly ToolCallReport[];
  readonly modelCalls: number;
  readonly budget: BudgetUsage;
}

/** Mutable working state owned by one loop invocation; never shared across runs. */
export interface LoopState {
  readonly history: Message[];
  readonly appended: Message[];
  readonly reports: ToolCallReport[];
  modelCalls: number;
  contextCheckpoint?: ContextCheckpoint;
}

export type Emit = (event: RuntimeEvent) => Promise<void>;
