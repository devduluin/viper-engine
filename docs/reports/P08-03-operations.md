# P08-03: standalone operations evidence

Result: PASS for standalone setup/operations acceptance. Session17-18 November2026, Asia/Jakarta.
No live model, V4/Hermes comparison, production deployment or desktop claim.

## Main workspace validation

| Check | Actual result |
| --- | --- |
| npm.cmd run check | 312 unit +157 contract =469 PASS, no failures/skips |
| Type/lint/architecture/docs/fixture gates | PASS |
| npm.cmd run api:export | Build/export PASS,13 SQL migration assets packaged |
| Compiled public construction smokes | All9 PASS |
| Full isolated PostgreSQL integration | 178/178 PASS |
| Scripted engine cold/warm regression | 60/60 PASS, all6 critical groups PASS |
| Raw artifact hashes / current source snapshot | Verified, sourceDrift[] / cleanupErrors[] |

Full regression artifact under artifacts/evals:
regression-2026-11-17T16-55-11-349Z-aca93d2f.
It retains manifest.json, report.json, unit.tap, contract.tap, integration.tap and60 raw trials.
The full offline gate log is artifacts/p08-03-check.log; verification metadata is
artifacts/p08-03-verification.json. These local ignored artifacts are not committed report files.

## Clean source installation

A separate directory artifacts/p08-03-clean-80f9e6f0 was populated with only explicit source,
tests, examples, tooling, docs, package/lock/TS metadata and the blank .env.example template.
No .env, node_modules, dist, application DB/data or V4 runtime was copied.

Commands executed there:

```text
npm.cmd ci --offline --ignore-scripts --no-audit --no-fund --cache D:\Development\.npm-cache
npm.cmd run build
npm.cmd run check
```

Installation added169 packages from the lockfile/cache with no network download. Build packaged
all13 SQL assets. All469 offline tests/type/lint/architecture/docs/fixture gates PASS in that
separate installation. Its install.log, build.log and check.log retain the actual output.
Every production/test/tooling source hash matches the main regression manifest; .env is absent.
This was a clean working directory on the existing Windows/Node/PostgreSQL host, not a fresh OS
VM or a cross-platform/other-PostgreSQL-version certification. Registry download was not tested.

## Compiled host and DB lifecycle

The clean installation ran standalone-operations.test.ts against its own random viper_it_* DB.
The child smoke imports runtime APIs only from its compiled dist, including SQL assets resolved
relative to the compiled bootstrap module. operations.tap records1/1 PASS. It verifies:

- Empty database refuses host startup before any model call.
- Explicit migrations initialize the new schema; a second migration applies nothing.
- Compiled read-only ops check returns not_migrated/exit1, ready/exit0, mismatch/exit1 as appropriate.
- HTTP persists a queued run; closing that listener and starting a new combined worker host
  completes the saved task exactly once with one scripted model call.
- Occupied-port startup fails with cleanup and leaves the queued task unclaimed/pool usable.
- Probe authentication returns401 without bearer; live and ready are200 with the correct identity.
- Schema checksum drift makes readiness503/schema_not_ready while liveness remains200.
- Idempotent close drains/stops worker; readiness reports draining and the caller can still query
  its pool before closing it. Signal listener cleanup and stalled-check behavior have unit evidence.

Targeted schema/operations tests also passed5/5 before full regression. Both clean/main tests
used the dedicated review server127.0.0.1:50568 and created/dropped only random viper_it_* DBs.
The review cluster was stopped after every invocation. No application/Workin/V4 DB was accessed.

## Scope and limits

The single-owner loopback starter is an executable example, not production multi-user identity
or OAuth provisioning. It uses existing provider adapters; verification uses scripted model
responses. Health checks local DB/schema/worker readiness and does not validate remote credentials.
No backup restore, rolling upgrade, throughput SLA, multi-host load or billed model measurement
was performed. Runbook states these limits and unknown external-effect reconciliation explicitly.

P08-03 adds no migration/dependency or change to approval/replay/cache semantics. It intentionally
requires packaged SQL assets and gates worker polling on schema validation. P08-04 remains the
release review task; V4/Hermes measurements stay NOT_MEASURED / comparison INCONCLUSIVE.

See [setup](../standalone-operations.md), [runbook](../operations-runbook.md),
[handoff](../handoffs/P08-03.md) and [review](../reviews/P08-03.md).
