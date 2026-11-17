import { scopeFromAuthenticatedIdentity } from '../../contracts/identity/scope.js';
import type { RunClaim } from '../../contracts/state/leases.js';
import type { RunStore } from '../../contracts/state/ports.js';
import { isTerminalRunStatus } from '../../contracts/state/run-state.js';
import type { Clock, IdGenerator } from '../../contracts/identity/ports.js';

/** Consecutive failed deliveries before a run is dead-lettered (with the default 1 s–5 min backoff, about 1.5 h). */
export const DEFAULT_MAX_DELIVERY_FAILURES = 20;

export function parseMaxDeliveryFailures(value: number = DEFAULT_MAX_DELIVERY_FAILURES): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new RangeError('Invalid max delivery failures');
  return value;
}

/**
 * Ends a run that keeps failing delivery as `failed` (reason `delivery_failures`) under the failed holder's
 * lease. A queued run is started first (queued cannot fail directly). A run with unsettled tool calls is
 * refused by the store's settlement rule and simply stays deferred: it must never hide an in-flight effect.
 */
export async function deadLetter(runs: RunStore, claim: RunClaim, clock: Clock, ids: IdGenerator): Promise<boolean> {
  const scope = scopeFromAuthenticatedIdentity(claim.owner);
  const current = await runs.get(scope, claim.runId);
  if (!current.ok || isTerminalRunStatus(current.value.status)) return false;
  let revision = current.value.revision;
  const event = (type: 'run.started' | 'run.failed', payload = {}) => ({ eventId: ids.next('run_event'), type, occurredAt: clock.now(), payload });
  if (current.value.status === 'queued') {
    const started = await runs.transition(scope, claim.runId, { to: 'running', expectedRevision: revision, at: clock.now(),
      lease: claim.lease, events: [event('run.started')] });
    if (!started.ok) return false;
    revision = started.value.revision;
  }
  const failed = await runs.transition(scope, claim.runId, { to: 'failed', expectedRevision: revision, at: clock.now(),
    lease: claim.lease, events: [event('run.failed', { reason: 'delivery_failures' })] });
  return failed.ok;
}
