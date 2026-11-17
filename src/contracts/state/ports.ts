import type { ConversationId, RunId, StepId, ToolCallId } from '../identity/ids.js';
import type { TrustedScope } from '../identity/scope.js';
import type { McpToolRef } from '../mcp/identity.js';
import type { ApprovalBinding, ApprovalId, ApprovalToolSnapshot, ArgumentsDigest } from './approval-state.js';
import type { JsonObject } from '../messages/json.js';
import type { NewRunEvent, RunEventRecord } from './events.js';
import type { LeaseToken } from './leases.js';
import type { ApprovalRecord, ConversationRecord, RunRecord, ToolCallRecord } from './records.js';
import type { StateResult } from './result.js';
import type {
  ApprovalConsumeRequest, ApprovalTransitionRequest, RunTransitionRequest, ToolCallTransitionRequest,
} from './transitions.js';

/**
 * Store ports for P03 in-memory and P04 PostgreSQL adapters. Contract for all implementations:
 * - Every method receives the server TrustedScope; rows of another owner behave as not_found.
 * - Writes are compare-and-set on `revision` and follow the reference rules in transitions.ts.
 * - A state change and its `events` commit atomically with gap-free per-run sequences.
 * - Expected conflicts return StateResult errors; infrastructure faults reject the Promise.
 * - IDs come from the server IdGenerator, never request JSON; a duplicate create is a fault.
 */
export interface ConversationStore {
  create(scope: TrustedScope, input: {
    readonly id: ConversationId; readonly title?: string; readonly at: number;
  }): Promise<StateResult<ConversationRecord>>;
  get(scope: TrustedScope, id: ConversationId): Promise<StateResult<ConversationRecord>>;
}

export interface RunStore {
  create(scope: TrustedScope, input: {
    readonly id: RunId; readonly conversationId: ConversationId; readonly at: number;
    readonly events: readonly NewRunEvent[];
  }): Promise<StateResult<RunRecord>>;
  get(scope: TrustedScope, id: RunId): Promise<StateResult<RunRecord>>;
  /** Reads tool-call statuses inside the same transaction; `request.toolCalls` is advisory input. */
  transition(scope: TrustedScope, id: RunId, request: Omit<RunTransitionRequest, 'toolCalls'> & {
    readonly events: readonly NewRunEvent[];
    /** Durable drivers pass their lease; a lost lease is `lease_lost` and nothing is written. */
    readonly lease?: LeaseToken;
  }): Promise<StateResult<RunRecord>>;
  requestCancellation(scope: TrustedScope, id: RunId, at: number, events: readonly NewRunEvent[]): Promise<StateResult<RunRecord>>;
  /** Authenticated control-plane wake only: waiting -> running, fencing the paused holder. */
  wake(scope: TrustedScope, id: RunId, request: { readonly expectedRevision: number; readonly at: number;
    readonly events: readonly NewRunEvent[] }): Promise<StateResult<RunRecord>>;
}

export interface ToolCallLedger {
  propose(scope: TrustedScope, input: {
    readonly id: ToolCallId; readonly runId: RunId; readonly stepId: StepId; readonly tool: McpToolRef;
    readonly argumentsDigest: ArgumentsDigest; readonly requiresApproval: boolean; readonly at: number;
    readonly lease?: LeaseToken;
  }): Promise<StateResult<ToolCallRecord>>;
  get(scope: TrustedScope, runId: RunId, id: ToolCallId): Promise<StateResult<ToolCallRecord>>;
  listByRun(scope: TrustedScope, runId: RunId): Promise<StateResult<readonly ToolCallRecord[]>>;
  /** Persist `dispatching` BEFORE the external call; persist the outcome after it returns. */
  transition(scope: TrustedScope, runId: RunId, id: ToolCallId, request: ToolCallTransitionRequest & {
    readonly events: readonly NewRunEvent[];
    readonly lease?: LeaseToken;
  }): Promise<StateResult<ToolCallRecord>>;
}

/** A new approval proposal: binding plus the exact snapshot the approver will see. */
export interface ApprovalProposal {
  readonly lease?: LeaseToken;
  readonly id: ApprovalId;
  readonly binding: ApprovalBinding;
  /** Must hash to `binding.argumentsDigest` under APPROVAL_ARGUMENTS_DIGEST. */
  readonly arguments: JsonObject;
  readonly toolSnapshot: ApprovalToolSnapshot;
  readonly expiresAt: number;
  readonly at: number;
  readonly events: readonly NewRunEvent[];
}

/** Parameter amendment: the old proposal is superseded and a new call + approval replace it. */
export interface ApprovalRevision {
  readonly expectedRevision: number;
  readonly at: number;
  readonly newToolCallId: ToolCallId;
  readonly newApprovalId: ApprovalId;
  readonly arguments: JsonObject;
  readonly argumentsDigest: ArgumentsDigest;
  readonly expiresAt: number;
  readonly events: readonly NewRunEvent[];
}

export interface ApprovalStore {
  propose(scope: TrustedScope, input: ApprovalProposal): Promise<StateResult<ApprovalRecord>>;
  /**
   * Atomic amendment: supersede the old approval, reject its call, propose the new call (same
   * tool and definition version) and its pending approval. The old proposal can never dispatch.
   */
  revise(scope: TrustedScope, id: ApprovalId, revision: ApprovalRevision): Promise<StateResult<{
    readonly superseded: ApprovalRecord; readonly approval: ApprovalRecord; readonly toolCall: ToolCallRecord;
  }>>;
  /** Server sweeper: pending/accepted approvals at or past expiry become `expired`. */
  expireDue(at: number, limit: number): Promise<number>;
  get(scope: TrustedScope, id: ApprovalId): Promise<StateResult<ApprovalRecord>>;
  decide(scope: TrustedScope, id: ApprovalId, request: ApprovalTransitionRequest & {
    readonly events: readonly NewRunEvent[];
  }): Promise<StateResult<ApprovalRecord>>;
  /**
   * Atomically consumes the approval AND moves the bound tool call to `dispatching`.
   * Either both commit or neither does; a second consumption fails as invalid_transition.
   */
  consumeForDispatch(scope: TrustedScope, id: ApprovalId, request: ApprovalConsumeRequest & {
    readonly toolCallExpectedRevision: number; readonly events: readonly NewRunEvent[]; readonly lease?: LeaseToken;
  }): Promise<StateResult<{ readonly approval: ApprovalRecord; readonly toolCall: ToolCallRecord }>>;
}

export interface RunEventReader {
  /** Events with sequence > afterSequence, ascending, at most `limit`. */
  readAfter(scope: TrustedScope, runId: RunId, afterSequence: number, limit: number): Promise<StateResult<readonly RunEventRecord[]>>;
}
