# Durable worker host

P06-03 adds `createEngineWorker(pool, engineOptions, workerOptions)` and the explicit executable
helper `runWorkerUntilSignal(worker)`. The worker reuses createViperEngine.runOnce, the atomic
journal and fenced PostgreSQL leases. It does not replace the agent loop or require Redis.

## Host composition

Apply migrations through **0010** to the explicitly configured engine database before running
the current stack. Migration 0009 adds run_deliveries; 0010 keeps event allocation replay-safe after pruning.
The host owns the database pool/migrations, model binding, credentials, connection selection
and execution policy. The worker owns its engine/MCP sessions. No factory auto-loads `.env`,
listens for HTTP, starts polling, installs process listeners or creates credentials on import.

```ts
import { createEngineWorker, runWorkerUntilSignal } from 'viper-engine';

const worker = createEngineWorker(pool, trustedEngineOptions, {
  workerId: 'engine-host-1',
  concurrency: 4,
  onEvent: event => recordSafeWorkerEvent(event),
});

try {
  await runWorkerUntilSignal(worker); // Explicit start, SIGINT/SIGTERM, await actual drain.
} finally {
  await pool.end();
}
```

For a host with its own signal/lifecycle management, use worker.start(), await worker.stop(),
and worker.done. Start is idempotent while running; restarting a stopped instance is rejected.
Construct a fresh worker for restart. Use unique workerId prefixes per host; slot suffixes are
added automatically. The default prefix uses a UUID. Status is a frozen snapshot, not live state.

HTTP and workers may run in different processes on the same new database. HTTP returns 202;
polling discovers queued/resumable work independently of the HTTP listener/client connection.
Closing HTTP does not cancel a run or stop the worker. User cancel persists durable intent.

Saved per-run HTTP context is loaded automatically and combined with configured host instructions.
Hosts already using persistedRunInstructions are supported: identical instruction IDs/content
deduplicate, while conflicting identities fail before provider invocation. Private system context
never becomes public conversation history. Model binding/policy must remain compatible on resume.

## Bounds and observation

| Setting | Default / bound |
| --- | --- |
| concurrency | 4 delivery slots; 1-32 |
| pollMs | 500ms; positive integer within Node timer range |
| maintenanceMs / maintenanceBatch | 5000ms / 100 eligible runs; batch 1-1000 |
| errorBackoffMs / maxErrorBackoffMs | Local slot/maintenance backoff 500ms / 30000ms |
| shutdownTimeoutMs | 15000ms |
| observerTimeoutMs | 1000ms; observers cannot indefinitely hold a delivery |
| retry.baseMs / maxMs / authenticationMs | Durable run cooldown 1000ms / 300000ms / 30000ms |

Tune concurrency against database pool/heartbeat/API capacity. Slots call runOnce sequentially;
different processes rely on FOR UPDATE SKIP LOCKED and lease fences, not a memory-only lock.
Idle/yielded deliveries sleep; settled work yields to the event loop before claiming again.
Failures exponentially back off locally. One maintenance loop runs separately from delivery slots.

status() includes phase, active/maxActive, settled/yielded/idle/failure counts, maintenance wakes/
failures, observer failures, last activity time and shutdown timeout state. Optional onEvent gets
delivery, safe failure code or maintenance count. It receives no raw SDK/SQL error, credential,
owner identity or tool arguments. Observer errors/timeouts do not retry completed work.
Detailed operations logging/metrics export and release health endpoints remain P08.

## Durable retries and fairness

Before a failed holder releases its lease, the scheduling hook checks its current owner/fence
and database-time lease expiry under the run lock. It stores a per-run failure count, safe code,
failed fence and database-time available_at atomically. Repeated scheduling for the same failed
generation is a no-op. Stale holders cannot postpone a new holder's work.

Claim admission skips future scheduled runs. Cooldown survives worker restart and cannot be
advanced by a caller timestamp. A failing setup therefore does not keep reclaiming the oldest
run while healthy work waits. Codes are authentication_required, connection_unavailable,
invalid_configuration and execution_failure. Authentication/configuration start at the longer
cooldown. Counts accumulate per run; successful processing does not rewrite/delete their history.
Metadata cleanup/retention is later operations work. Changes to external auth/config are retried
when due; there is no implicit OAuth reauthorization or public force-retry API here.

These are **work-delivery retries**, never permission to repeat a completed/unknown remote action.
The driver first recovers persisted evidence: confirmed calls are not replayed; in-flight effects
become unknown and end partial/cancelled. A failed deferral due to storage outage still triggers
local backoff. There is no fallback to memory scheduling for distributed correctness.

Cancellation bypasses cooldown and cleanup skips model/MCP configuration. Revoked credentials
or failing discovery cannot prevent a queued/managed run from being cancelled. Corrupt/unmanaged
execution state still fails closed rather than inventing remote outcomes.

## Approval expiry maintenance

Maintenance finds bounded waiting_for_approval candidates with expired proposals and no live
pending decision. It locks runs first with SKIP LOCKED, expires due pending/accepted approvals,
then explicitly wakes/fences the run in the same transaction. Competing sweepers cannot wake it
twice. A fresh pending proposal keeps the run paused. No model or tool call occurs in maintenance.
The next worker applies current catalog/schema/policy and exact approval consumption. Expired
actions are rejected; a still-valid accepted sibling remains subject to its existing grant.

## Shutdown and restart

stop aborts further claims and active work, closes MCP sessions, and waits for delivery/maintenance
loops. Worker shutdown yields work; it does not write user cancellation. Lost/shutdown guards
stop scheduling heartbeats, so lingering work cannot indefinitely extend a lease. DB fence checks
still reject late writes. No arbitrary remote effect is promised exactly-once execution.

If shutdown exceeds its deadline, stop rejects and status remains stopping with stopTimedOut.
It does **not** claim I/O drained. worker.done settles when outstanding work actually finishes;
keep shared resources alive until then. A supervisor may terminate a stuck process; another
worker recovers after lease expiry. The signal helper waits for done and removes its listeners;
it never calls process.exit during an in-flight action.

Validation includes actual HTTP enqueue/close, two polling hosts, durable auth cooldown across
restart, cancellation without discovery, private context, concurrent expiry maintenance, actual
MCP effect/shutdown recovery and an OS-killed polling process. No live provider key is used.
See [P06-03 handoff](handoffs/P06-03.md) and [review](reviews/P06-03.md).
