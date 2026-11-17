import type { TrustedScope } from '../../../contracts/identity/scope.js';
import { ApiFailure } from '../../../contracts/api/failure.js';
import type { SseOptions } from './types.js';

/** Bounded process-local connections, not an execution lock or a replacement for durable state. */
export class StreamSessions {
  private readonly live = new Set<() => void>();
  private readonly owners = new Map<string, number>();
  private closed = false;
  constructor(private readonly options: SseOptions) {}

  acquire(scope: TrustedScope, controller: AbortController, destroy: () => void) {
    const key = JSON.stringify([scope.actorId, scope.appId, scope.tenantId ?? '']);
    if (this.closed) throw new ApiFailure('CONNECTION_UNAVAILABLE');
    if (this.live.size >= this.options.maxStreams || (this.owners.get(key) ?? 0) >= this.options.maxStreamsPerScope) {
      throw new ApiFailure('RATE_LIMITED', { action: 'retry_later', retryAfterMs: 1000 });
    }
    const close = () => { controller.abort(); destroy(); };
    this.live.add(close); this.owners.set(key, (this.owners.get(key) ?? 0) + 1);
    const timer = setTimeout(close, this.options.maxStreamMs); let released = false;
    return () => {
      if (released) return; released = true; clearTimeout(timer); this.live.delete(close);
      const remaining = (this.owners.get(key) ?? 1) - 1;
      if (remaining === 0) this.owners.delete(key); else this.owners.set(key, remaining);
    };
  }

  close() { this.closed = true; for (const close of this.live) close(); }
}
