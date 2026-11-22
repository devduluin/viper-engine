import type { MessageId, RunId } from '../identity/ids.js';
import type { SteeringSettleMode } from './steering.js';
import type { TrustedScope } from '../identity/scope.js';
import type { JsonObject } from '../messages/json.js';
import type { RunCheckpoint, MessageAppend } from './checkpoints.js';
import type { ExecutionLedger } from './execution-records.js';
import type { LeaseToken } from './leases.js';
import type { ApprovalStore, ToolCallLedger, RunStore } from './ports.js';
import type { StateResult } from './result.js';

export type JournalCommand =
  | { readonly kind: 'messages'; readonly input: MessageAppend }
  | { readonly kind: 'tool_proposal'; readonly input: Parameters<ToolCallLedger['propose']>[1] }
  | { readonly kind: 'tool_transition'; readonly id: Parameters<ToolCallLedger['transition']>[2]; readonly input: Parameters<ToolCallLedger['transition']>[3] }
  | { readonly kind: 'approval_proposal'; readonly input: Parameters<ApprovalStore['propose']>[1] }
  | { readonly kind: 'approval_consume'; readonly id: Parameters<ApprovalStore['consumeForDispatch']>[1]; readonly input: Parameters<ApprovalStore['consumeForDispatch']>[2] }
  | { readonly kind: 'run_transition'; readonly input: Parameters<RunStore['transition']>[2] }
  | { readonly kind: 'step_start'; readonly input: Parameters<ExecutionLedger['startStep']>[1] }
  | { readonly kind: 'step_finish'; readonly input: Parameters<ExecutionLedger['finishStep']>[1] }
  | { readonly kind: 'model_start'; readonly input: Parameters<ExecutionLedger['startModelCall']>[1] }
  | { readonly kind: 'model_finish'; readonly input: Parameters<ExecutionLedger['finishModelCall']>[1] }
  /** Settles exactly these pending steering inputs as consumed; their messages are appended in the same commit. */
  | { readonly kind: 'steering_consume'; readonly messageIds: readonly MessageId[] }
  /** Before a stop: refuse while inputs wait (`require_none`), or mark the waiting ones discarded. */
  | { readonly kind: 'steering_settle'; readonly mode: SteeringSettleMode };

/** Atomic execution boundary: state/budgets, ledger, messages and events all commit or none do. */
export interface RunJournal {
  commit(scope: TrustedScope, runId: RunId, input: {
    readonly lease: LeaseToken; readonly at: number; readonly expectedRevision: number;
    /** Versioned application-owned snapshot, never accepted from client JSON. */
    readonly state: JsonObject; readonly commands: readonly JournalCommand[];
  }): Promise<StateResult<RunCheckpoint>>;
}
