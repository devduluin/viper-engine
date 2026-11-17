import type { ApprovalBinding, ApprovalId } from '../../contracts/state/approval-state.js';
import type { ApprovalRecord } from '../../contracts/state/records.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { ToolCallId } from '../../contracts/identity/ids.js';
import type { ToolCall } from '../../contracts/messages/message.js';
import type { ContentBlock } from '../../contracts/messages/content.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import type { McpToolRef } from '../../contracts/mcp/identity.js';
import type { StepContext } from '../../agent/runtime/model-step.js';
import type { RunLoopDependencies, RunLoopResult } from '../../agent/runtime/types.js';
import type { RuntimeTool } from '../../agent/execution/tool-catalog.js';

export interface SessionDependencies extends RunLoopDependencies {
  /** Trusted application lookup; rechecks current ownership/catalog/access before resuming. */
  readonly refreshTools: (scope: TrustedScope) => Promise<readonly RuntimeTool[]>;
}

export interface InputAction {
  readonly inputId: string;
  readonly expectedRevision: number;
  readonly content: readonly ContentBlock[];
}

export interface ApprovalDecision {
  readonly approvalId: ApprovalId;
  readonly expectedRevision: number;
  readonly binding: ApprovalBinding;
  readonly decision: 'accept' | 'reject';
}

export interface ReviseProposal {
  readonly approvalId: ApprovalId;
  readonly expectedRevision: number;
  readonly arguments: JsonObject;
}

export type SessionAction =
  | { readonly kind: 'input_required'; readonly question: string }
  | { readonly kind: 'catalog_changed'; readonly toolCallId: ToolCallId; readonly name: string }
  | { readonly kind: 'approval_required'; readonly approvalId: ApprovalId; readonly revision: number;
    readonly binding: ApprovalBinding; readonly arguments: JsonObject;
    readonly status: ApprovalRecord['status']; readonly expiresAt: number };

export interface SessionView extends RunLoopResult {
  /** Local session command revision. P06 maps durable API revisions through the store. */
  readonly revision: number;
  readonly actions: readonly SessionAction[];
}

export interface HeldCall { readonly call: ToolCall; readonly tool: McpToolRef; readonly approvalId?: ApprovalId }

/** Ephemeral server state. No serialized hydration/resume or repository interface is introduced here. */
export interface SessionState {
  context: StepContext;
  result: RunLoopResult;
  revision: number;
  busy: boolean;
  poisoned: boolean;
  readonly deps: SessionDependencies;
  readonly approvalTtlMs: number;
  readonly approvals: Map<ApprovalId, ApprovalRecord>;
  readonly pending: Map<string, HeldCall>;
  readonly inputs: Map<string, { readonly fingerprint: string; readonly view: SessionView }>;
  readonly cancellation: AbortController;
}

export class SessionError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = 'SessionError'; }
}
