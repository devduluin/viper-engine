import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunCheckpoint, CheckpointReader } from '../../contracts/state/checkpoints.js';
import type { RunJournal } from '../../contracts/state/journal.js';
import type { RunLeaseStore, RunClaim } from '../../contracts/state/leases.js';
import type { RunStore } from '../../contracts/state/ports.js';
import type { RunSteeringReader } from '../../contracts/state/steering.js';
import type { RunLoopDependencies, RunLoopInput } from '../../agent/runtime/types.js';

export interface DurableDriverDependencies extends RunLoopDependencies {
  readonly leases: RunLeaseStore; readonly runs: RunStore; readonly checkpoints: CheckpointReader; readonly journal: RunJournal;
  /** Mid-run user messages queued by the API; absent = steering off (waiting inputs are discarded at stop). */
  readonly steeringInputs?: RunSteeringReader;
  /** Trusted server composition refreshes authorized tools and instructions for this owner. */
  readonly configure: (scope: TrustedScope, checkpoint: RunCheckpoint) => Promise<Omit<RunLoopInput,
    'scope' | 'conversationId' | 'runId' | 'history' | 'resume' | 'signal'>>;
  readonly provider: string;
  readonly resolveRunModel?: ((pinned?: { readonly provider: string; readonly model: string }, runId?: RunClaim['runId']) => {
    readonly provider: string; readonly model: string; readonly gateway: RunLoopDependencies['model'];
  } | Promise<{ readonly provider: string; readonly model: string; readonly gateway: RunLoopDependencies['model'] }>) | undefined;
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
