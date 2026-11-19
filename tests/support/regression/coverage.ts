/** Existing deterministic cases remain the authority for crash/lease/stream invariants. */
export const CRITICAL_COVERAGE = Object.freeze([
  { invariant: 'ownership/auth/tenant isolation', files: ['tests/integration/postgres/http-start.test.ts', 'tests/integration/postgres/recall.test.ts', 'tests/integration/postgres/learning.test.ts'] },
  { invariant: 'exact approval/no revoked grants/user decline', files: ['tests/integration/postgres/approval-policy.test.ts', 'tests/integration/postgres/user-rejection.test.ts'] },
  { invariant: 'leases/fencing/idempotency', files: ['tests/integration/postgres/leases.test.ts', 'tests/integration/postgres/idempotency-execution.test.ts'] },
  { invariant: 'OS-kill recovery/no completed-call replay', files: ['tests/integration/postgres/durable-restart.test.ts', 'tests/integration/postgres/context-restart.test.ts', 'tests/integration/postgres/learning-maintenance.test.ts'] },
  { invariant: 'HTTP/SSE replay/cancel/backpressure', files: ['tests/integration/postgres/sse-replay.test.ts', 'tests/integration/postgres/sse-boundaries.test.ts', 'tests/integration/postgres/headless-recovery.test.ts'] },
  { invariant: 'context/source/feedback boundaries', files: ['tests/integration/postgres/context-engine.test.ts', 'tests/integration/postgres/recall-engine.test.ts', 'tests/integration/postgres/planning.test.ts', 'tests/integration/postgres/learning-evidence.test.ts'] },
]);
