# P08-01: engine regression evidence

Status: PASS.17 November2026. Synthetic fixtures, explicit isolated PostgreSQL review server.
No live provider/Workin/V4/Hermes execution or comparison claim.

## Actual invocations

- `npm.cmd run eval:offline`: PASS,292 unit +152 contract =444 tests, zero failures/skips/cancellations.
  Artifact ID: regression-2026-11-17T14-29-30-699Z-47c9ec97.
- `node --import tsx examples/regression.ts postgres`: PASS, same444 plus175 PostgreSQL tests;
  all60 engine trials PASS, sourceDrift[] and cleanupErrors[]. Test file concurrency4, engine trials1.
  Artifact ID: regression-2026-11-17T14-29-50-954Z-0b7c0a37.
- Review helper injects only explicit loopback VIPER_TEST_DB_* for cluster50568, creates/drops its
  own viper_it_* DBs, and stops the review server in finally. No `.env` or provider key read.

Both folders are under artifacts/evals/ and contain manifest.json, report.json, raw TAP and trial
JSON. SHA256 checksums verified against all retained evidence; source hashes match the current
tested tree. Raw TAP summaries matched reported counts in a separate verification step; all60
grades recomputed from retained raw observations matched their saved values.

Complete critical suites PASS: scope/auth/tenant, exact approval/decline/revoke, leases/fencing/
idempotency, actual OS-kill/no-effect replay, HTTP/SSE/cancel/backpressure, context/recall/learning.
Seven new unit tests cover metrics/evidence/drift/child-env grading; one new PG test checks all20
cold/warm observations. Production runtime/API/schema/dependencies unchanged by this task.

## Local cold/warm measurements

Ten unique development fixtures x3 repeats x2 modes =60 trials. Independent conversation/run and
reset business effects per trial; repeat pairs start a fresh DB/server/engine. Warm reuses one
engine/SDK pool, not an assertion of a cache hit. Actual catalog pages are counted.

| Aggregate over30 trials per mode | Cold | Warm |
| --- | ---: | ---: |
| Deterministic grades passed | 30 | 30 |
| Audited model calls | 54 | 54 |
| Remote tool dispatches | 18 | 18 |
| Catalog page requests | 324 | 234 |
| Local lifecycle p50 ms | 248.55 | 142.03 |
| Local lifecycle p95 ms | 1864.86 | 1751.28 |
| Known scripted input tokens | 480 | 480 |
| Known scripted output tokens | 240 | 240 |
| Known scripted total tokens | 720 | 720 |
| Trials with unknown token fields | 3 | 3 |
| Billed cost | NOT MEASURED | NOT MEASURED |

Latency nearest-rank, n30 aggregate/n3 per case; full per-case distributions are in report.json.
The1500ms unknown-write timeout dominates the aggregate tail. These are heterogeneous local
fixture timings with synthetic approval/input, not production throughput or provider benchmarks.
Setup/migrations/grading/replay assertions are outside the timer. Cold/warm differences do not
establish a causal cache improvement or model-quality gain.

Usage counters are scripted SDK values; clarification uses a scripted port with unavailable usage.
Unknown fields remain unknown rather than zero. Zero-attempt cancellation is separately evidenced.
All108 model calls and36 tool dispatches across modes are counted; no planner/judge calls.

## Interpretation

Grading requires persisted effects/audit, exact approval, refusal codes, scope and no replay.
An acknowledged declined/invalid write may finish its dialogue as completed while its operation
remains rejected and unexecuted. Passing safety cases with expected failed/partial/refused outcomes
is not a100% semantic task-completion claim.

Live model quality, billed consumption, actual provider/cache/network cold-warm latency and
V4/Hermes scores remain NOT MEASURED. Ten development cases are not120 comparison tasks or30
holdouts. Optional planning stays default off. P08-02 owns comparative evaluation; standalone
operations and release readiness remain P08-03/04. See [guide](../engine-regression.md).
