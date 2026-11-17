import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunCheckpoint, CheckpointReader } from '../../contracts/state/checkpoints.js';
import type { RunJournal } from '../../contracts/state/journal.js';
import type { RunLeaseStore, RunClaim } from '../../contracts/state/leases.js';
import type { RunStore } from '../../contracts/state/ports.js';
import type { RunLoopDependencies, RunLoopInput } from '../../agent/runtime/types.js';

export interface DurableDriverDependencies extends RunLoopDependencies {
  readonly leases: RunLeaseStore; readonly runs: RunStore; readonly checkpoints: CheckpointReader; readonly journal: RunJournal;
  /** Trusted server composition refreshes authorized tools and instructions for this owner. */
  readonly configure: (scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<Omit<RunLoopInput,
    'scope' | 'conversationId' | 'runId' | 'history' | 'resume' | 'signal'>>;
  readonly provider: string;
  readonly leaseMs?: number;
  readonly heartbeatMs?: number;
  /** Approval proposal lifetime in ms (positive safe integer, default 60000); checked when the driver is built. */
  readonly approvalTtlMs?: number;
  /** Host scheduling runs before release; callbacks must not dispatch tools or relax fencing. */
  readonly onDeliveryFailure?: (claim: RunClaim, error: unknown) => Promise<void>;
}

export type DriverResult =
  | { readonly kind: 'idle' }
  | { readonly kind: 'yielded'; readonly runId: RunClaim['runId'] }
  | { readonly kind: 'settled'; readonly runId: RunClaim['runId']; readonly status: string; readonly reason: string };
