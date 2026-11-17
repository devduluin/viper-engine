import type { Clock } from '../../contracts/identity/ports.js';
import { withDeadline } from '../../shared/async/deadline.js';
import { DeadlineExceededError } from '../../shared/async/errors.js';
import { assertTimerDuration } from '../../shared/async/delay.js';

export class RunInterrupted extends Error {
  constructor(readonly reason: 'cancelled' | 'deadline_exceeded') { super(reason); this.name = 'RunInterrupted'; }
}

/** Real timer bounds uncooperative gateways; injected epoch clock also detects deterministic expiry. */
export class RunControl {
  readonly deadlineAt: number;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onCancel = () => this.controller.abort(new RunInterrupted('cancelled'));

  constructor(private readonly clock: Clock, durationMs: number, deadlineAt?: number, private readonly caller?: AbortSignal) {
    assertTimerDuration('durationMs', durationMs);
    const now = clock.now();
    if (!Number.isFinite(now)) throw new RangeError('Invalid clock instant');
    if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) throw new RangeError('Invalid deadline');
    this.deadlineAt = Math.min(now + durationMs, deadlineAt ?? Infinity);
    this.timer = setTimeout(() => this.controller.abort(new RunInterrupted('deadline_exceeded')), Math.max(0, this.deadlineAt - now));
    caller?.addEventListener('abort', this.onCancel, { once: true });
    if (caller?.aborted === true) this.onCancel();
  }

  get signal(): AbortSignal { return this.controller.signal; }

  check(): 'cancelled' | 'deadline_exceeded' | undefined {
    if (this.caller?.aborted === true) return 'cancelled';
    if (this.clock.now() >= this.deadlineAt) this.controller.abort(new RunInterrupted('deadline_exceeded'));
    const reason: unknown = this.signal.reason;
    return reason instanceof RunInterrupted ? reason.reason : undefined;
  }

  async call<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const stopped = this.check();
    if (stopped !== undefined) throw new RunInterrupted(stopped);
    try {
      return await withDeadline(operation, {
        operationName: 'agent gateway', signal: this.signal,
        timeoutMs: Math.max(0, this.deadlineAt - this.clock.now()),
      });
    } catch (error) {
      if (error instanceof DeadlineExceededError) this.controller.abort(new RunInterrupted('deadline_exceeded'));
      const reason = this.check();
      if (reason !== undefined) throw new RunInterrupted(reason);
      throw error;
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener('abort', this.onCancel);
  }
}
