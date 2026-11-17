import type { RunCheckpoint } from '../../contracts/state/checkpoints.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { DurableDriverDependencies } from './types.js';
import type { LeaseGuard } from './lease-guard.js';
import { withDeadline } from '../../shared/async/deadline.js';

/** Cancellation cleanup must not depend on healthy credentials, MCP discovery or provider access. */
export async function deliveryPlan(deps: DurableDriverDependencies, scope: TrustedScope, checkpoint: RunCheckpoint, guard: LeaseGuard) {
  await guard.refresh();
  if (guard.cancelled) return { model: 'cancelled', maxModelCalls: 1, maxOutputTokens: 1, tools: [] };
  return withDeadline(() => deps.configure(scope, checkpoint), { operationName: 'durable configuration',
    timeoutMs: deps.leaseMs ?? 30000, signal: guard.controller.signal });
}
