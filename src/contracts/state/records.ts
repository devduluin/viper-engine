import type { ActorId, ConversationId, RunId, StepId, ToolCallId } from '../identity/ids.js';
import type { JsonObject } from '../messages/json.js';
import type { McpToolRef } from '../mcp/identity.js';
import type { ApprovalBinding, ApprovalId, ApprovalStatus, ApprovalToolSnapshot, ArgumentsDigest } from './approval-state.js';
import type { OwnerScope } from './owner.js';
import type { RunStatus } from './run-state.js';
import type { ToolCallStatus } from './tool-call-state.js';

/**
 * Provider-neutral state records. Timestamps are UTC epoch milliseconds from the injected Clock.
 * Every mutable record carries `owner` and a compare-and-set `revision` starting at 1.
 */
interface OwnedRecord {
  readonly owner: OwnerScope;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ConversationRecord extends OwnedRecord {
  readonly id: ConversationId;
  readonly title?: string;
}

export interface RunRecord extends OwnedRecord {
  readonly id: RunId;
  readonly conversationId: ConversationId;
  readonly status: RunStatus;
  /** Durable cancellation intent; the driver settles in-flight work before the run is cancelled. */
  readonly cancelRequestedAt?: number;
}

export interface ToolCallRecord extends OwnedRecord {
  /** Model-issued call ID; unique within its run, paired with exactly one tool result. */
  readonly id: ToolCallId;
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly status: ToolCallStatus;
  /** Exact connection/server/name/definition version validated at proposal time. */
  readonly tool: McpToolRef;
  readonly argumentsDigest: ArgumentsDigest;
  readonly requiresApproval: boolean;
  /** Number of times dispatch intent was recorded; never reset. */
  readonly attempts: number;
}

export interface ApprovalRecord extends OwnedRecord {
  readonly id: ApprovalId;
  readonly status: ApprovalStatus;
  readonly binding: ApprovalBinding;
  readonly expiresAt: number;
  /** Durable stores keep the exact final arguments and tool definition the approver saw. */
  readonly arguments?: JsonObject;
  readonly toolSnapshot?: ApprovalToolSnapshot;
  /** Authenticated actor who accepted/rejected; never derived from model or tool output. */
  readonly decidedBy?: ActorId;
  /** Set when a revision replaced this proposal. */
  readonly supersededBy?: ApprovalId;
}
