import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunClaim } from '../../contracts/state/leases.js';
import type { DurableDriverDependencies } from './types.js';

export class LeaseInterrupted extends Error {}

/** Sequential heartbeats, cancellation polling, local expiry and worker shutdown admission. */
export class LeaseGuard {
  readonly controller = new AbortController();
  private expiresAt: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private closed = false;
  private lost = false;
  cancelled = false;
  private readonly onStop = () => { this.lost = true; this.controller.abort(); };

  constructor(private readonly claim: RunClaim, private readonly scope: TrustedScope,
    private readonly deps: DurableDriverDependencies, private readonly shutdown?: AbortSignal) {
    this.expiresAt = claim.expiresAt;
    shutdown?.addEventListener('abort', this.onStop, { once: true });
    if (shutdown?.aborted) this.onStop();
  }

  start(): void { this.schedule(); }

  get interrupted(): boolean { return this.lost || this.deps.clock.now() >= this.expiresAt; }

  assert(): void {
    if (this.lost || this.deps.clock.now() >= this.expiresAt) {
      this.lost = true; this.controller.abort(); throw new LeaseInterrupted('Worker no longer holds the run');
    }
  }

  async refresh(): Promise<void> {
    this.assert();
    const run = await this.deps.runs.get(this.scope, this.claim.runId);
    this.assert();
    if (!run.ok) throw new LeaseInterrupted('Run unavailable');
    if (run.value.cancelRequestedAt !== undefined) { this.cancelled = true; this.controller.abort(); }
  }

  async close(): Promise<void> {
    this.closed = true; clearTimeout(this.timer);
    this.shutdown?.removeEventListener('abort', this.onStop);
    await this.pending;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      if (this.closed || this.lost) return;
      this.pending = this.beat().catch(() => { this.lost = true; this.controller.abort(); });
      void this.pending.finally(() => { if (!this.closed && !this.lost) this.schedule(); });
    }, this.deps.heartbeatMs ?? Math.floor((this.deps.leaseMs ?? 30000) / 3));
  }

  private async beat(): Promise<void> {
    const renewed = await this.deps.leases.renew(this.claim.runId, this.claim.lease, this.deps.clock.now(), this.deps.leaseMs ?? 30000);
    if (!renewed.ok) throw new LeaseInterrupted('Lease renewal failed');
    this.expiresAt = renewed.value.expiresAt;
    await this.refresh();
  }
}
