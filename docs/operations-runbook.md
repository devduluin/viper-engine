# Engine operations runbook

Applies to P08-03 combined standalone host and existing separate HTTP/worker factories.
Use [setup](standalone-operations.md) first. Operate only the deployment's new engine database.
No tool below authorizes destructive data resets or a production deployment.

## Start, stop and restart

1. Back up the engine database before schema upgrades. Preserve matching source/dist, lockfile,
   migration SQL and checksums, configuration version and secret references.
2. Stop intake and drain workers before an upgrade that changes schema/model/policy. Use one
   compatible build across replicas. Rolling upgrades are not certified by P08-03.
3. Run db:migrate explicitly, then ops:check. A migration failure rolls back its transaction;
   fix the cause and rerun. Startup refuses absent/pending/drifted or newer unknown migrations.
4. Start the configured host and check authenticated /health/live and /health/ready.
5. For graceful shutdown send SIGINT/SIGTERM (Ctrl+C locally). The combined host marks itself
   draining, closes intake/SSE sessions and stops/drains the worker. It then releases the caller's
   pool in the executable's finally block. Client disconnect alone never cancels durable runs.

Worker shutdown default is15000ms. If drain fails, shutdown reports failure; use your supervisor's
termination grace appropriate to active requests/leases and review durable state after restart.
There is no claim that every remote operation can be cancelled on process termination.

Restart with stable actor/app IDs, cursor secret, provider/model, connection namespace and policy
settings. Queued work is claimed through PostgreSQL. Waiting input/approval requires the intended
client decision; restart is not approval. Worker cooldowns and exact call/approval records survive.
Lease claim/renewal duration uses DB time. Keep worker clocks correct for local deadlines and
timestamps; caller clock skew cannot authorize early lease takeover. New SQL migrations must also
update the build's ENGINE_SCHEMA_VERSION pin; truncated assets fail build/migrate/readiness.

## Recovery and remote side effects

After a crash, allow the previous lease to expire; a fresh worker reclaims/fences the durable run.
It restores journal/checkpoint evidence. Confirmed completed calls are not redispatched. In-flight
external effects with unknown outcome must be reconciled before any new attempt. Never clear the
ledger, fabricate completion, bulk reset runs to queued or replay a write to "make it work".

Cancellation persists intent and is processed even if model/MCP discovery is unavailable. If a
client lost its stream, reload the run snapshot and resume via the returned event cursor. Expired
cursors require snapshot recovery; do not start a duplicate run. See [stream guide](event-stream.md),
[driver](durable-driver.md) and [headless client](headless-client.md).

Repeated configuration/auth/discovery failure uses durable retry backoff. After the configured
maxDeliveryFailures (default20), the worker marks the run failed; fixing credentials does not
silently reopen a terminal run. Inspect safe failure codes and run evidence; any new attempt uses
an explicit new task and must account for possible external effects.

## Diagnosis

| Observation | Action |
| --- | --- |
| ops:check configuration_or_database_unavailable | Check required VIPER_DB_* values, reachability/TLS/role and packaged SQL assets privately; no environment dumps |
| not_migrated or pending | Verify DB target, run migrations from this build, then check again |
| mismatch / readiness schema_not_ready | Compare deployed migration assets and ledger; stop rollout, do not edit historical SQL or checksums |
| readiness database_unavailable | Check DB reachability/capacity/locks; probe timeout is not query cancellation |
| readiness worker_unavailable | Inspect process/worker phase and safe failure counters; restart with a fresh host after resolving cause |
| readiness draining | Host is shutting down; remove it from intake and await drain |
| health401 | Supply the configured bearer; monitor auth is required |
| start:local generic startup failure | Check local secret/identity/provider config, run ops:check; ensure VIPER_HOST is loopback and port is free |
| queued runs never progress | Confirm worker is running, schema ready, DB target/shared identities, cooldown/lease and configured model/connections |
| waiting_for_approval/input | Use authenticated API to inspect and submit exact decision/input; do not bypass it with SQL |
| authentication_required / revoked MCP | Restore the owner's credential/access through host adapters; revoked connections need new authorization |

ops:check deliberately returns safe categories. It neither probes the provider nor provisions a
key. Inspect detailed PostgreSQL service logs only through the deployment's approved private
logging channel. Keep credentials, raw prompts, MCP payloads and connection URLs out of reports.

## Backup and restore

Use a PostgreSQL-consistent backup of the whole new engine DB, including journal, leases,
idempotency, approvals, events, notes/proposals and migration ledger. Retain matching runtime
and SQL assets; keep backup secrets separately. P08-03 verifies fresh bootstrap/restart, not an
automated disaster-recovery/backup system or a measured restore time objective.

Restore first into a separate database with workers stopped and outbound side effects disabled.
Verify schema compatibility and access scope. Check whether effects happened after the backup:
a restored ledger may predate real writes. Reconcile those effects before enabling workers.
Do not rewind a live database while workers/clients still use it. No automated down migration or
replay command is provided; an incompatible rollback requires an explicit recovery plan.

## Capacity, retention and scaling

Start with bounded worker concurrency (default4, max32) and pool size (default10 per process).
Budget pool slots for API, maintenance, heartbeat, leases and readiness; more replicas multiply
connections. Watch safe worker settled/yielded/failure/maintenance counts, active slots, DB
connections/locks, run age and readiness failures. Health ready is not a throughput/quality SLA.

HTTP and workers can scale separately using existing factories. Coordinate auth, secrets, model/
catalog/policy versions and migration rollout. Redis, desktop/device state and delegated agents
are not required. Tenant authorization remains per request/dispatch, never a process-wide bypass.

Event/idempotency retention affects client recovery and deduplication. There is no all-data purge
daemon in this phase. Choose deployment retention/access/backup policies explicitly; deleting
tool-call or approval evidence while runs may resume can destroy recovery guarantees.

## Release evidence

Run offline check/build/export and explicit isolated integration before releasing a build.
Retain raw TAP, source/config/migration manifests and outcomes. Use eval:regression for the
scripted local suite and eval:compare only for actual compatible captures. P08-02's V4/Hermes
comparison remains INCONCLUSIVE; operational readiness does not establish model superiority.
P08-04 reviews release evidence and remaining extensions; production deployment is separate.
