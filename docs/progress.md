# Progress and handoff ledger

Packaging follow-up: IMPLEMENTED / LOCAL VALIDATION PASS, GPT,18 November2026. Host env ownership,
versioned packaging and Compose prepared; engine486 offline/PG185/60 trials, host19 and clean runtime PASS.
Actual Compose CLI/schema PASS, production audit0; Docker build NOT_RUN. Read handoffs/PACKAGING.md
and sibling viper-host/docs/PACKAGING-REVIEW.md. No publish/deploy or real secret file changed.

## Current state - R2.1

- Tanggal:18 November2026, Asia/Jakarta.
- P00 foundation: DONE (P00-01, P00-02, P00-03, P00-04).
- Primary stack: strict TypeScript/Node ESM/PostgreSQL/Fastify; no next R2.1 DAG task, controlled-pilot decision.
- Context/API schemas, durable driver, model/MCP E2E, HTTP control, worker dan SSE/replay tersedia.
- P04-01 Claude DONE setelah temuan diperbaiki owner dan 24 integration tests lulus review ulang.
- Utility adoption berjalan per P02 handoffs; legacy database tidak diakses atau diubah.
- V4/Hermes benchmark: NOT MEASURED. Desktop/delegation/legacy migration: DEFERRED.
- P00-P08 DONE (36/36); release review READY_FOR_CONTROLLED_PILOT; planning default off, automatic planner deferred.
- OpenAI P05-01b extension reviewed/DONE; tidak menambah task DAG. Live OpenAI smoke belum dijalankan.
- Latest gates: check486 offline, isolated PG185/185 and60/60 engine trials PASS; clean packaged host19 tests/runtime PASS. Source/raw hashes verified in packaging capture f7a2f07f; Docker build pending. V4/Hermes captures NOT_MEASURED.
- P07-01 DONE (Codex): bounded context/summary checkpoint and restart evidence. Workin handoff
  source triaged; live rerun/session diagnostics remain separate. User-rejected approval fix DONE.
- Workin rejection follow-up DONE (Codex); handoffs/WORKIN-REJECTION.md. Other findings/P07-02 separate.
- MCP session/resource correction and P07-02 DONE (Codex); handoffs/WORKIN-MCP-SESSION.md,
  handoffs/P07-02.md and scoped-recall.md document exact behavior, migration and limits.
- P01-03 Claude DONE setelah review; P01-04 API schemas Codex DONE, 213 tests/build/export PASS.
- P03-02 Claude selesai direview; P03-03 Codex DONE, 236 unit/contract tests dan build PASS.
- P03-04 Codex DONE: in-memory scoped input/approval/resume; 285 unit/contract tests + build/export PASS.

## Revision history

R1: 52-task roadmap. R2: 36 tasks berfokus engine MCP-first/DB baru, desktop ditunda.
R2.1: task-level DAG menggantikan phase-wide sequencing agar independent work dapat paralel.
36 task IDs/scopes tetap; dependency source of truth: task-dependencies.json.

## Foundation evidence

P00 artifacts and validation preserved in [foundation archive](progress-foundation-2026-11-16.md).

## Task ownership

| Task | Status | Owner | Next step |
| --- | --- | --- | --- |
| P00-01..04 | DONE | Codex integration | All acceptance and local gates passed |
| P01-01 | DONE | identity_contracts + integration | Contracts, tests dan public exports verified |
| P02-01 | DONE | utility_manifest + integration | 17 hashes verified; 5 source modules selected |
| P01-02 | DONE | Codex (lane C) | SDK-free model/MCP ports; 17 contract tests and full gates PASS |
| P01-03 | DONE | Claude + Codex review | State/schema reviewed; safe revision/event-sequence guard; 168 tests/build PASS |
| P01-04 | DONE | Codex | 41 schemas / 12 operations / 13 durable event types; 213 tests/build/export PASS |
| P02-02 | DONE | Claude + Codex review | Async cancellation/deadline/retry/batch evidence reviewed; full gates PASS |
| P02-03 | DONE | Claude + Codex integration | Safe token count guard and overflow regression added; full gates PASS |
| P02-04 | DONE | Codex | Preserving MCP normalization + canonical SHA-256; full gates PASS |
| P03-01 | DONE | Codex | Context + deterministic fixtures; docs/handoffs/P03-01.md; full gates PASS |
| P03-02 | DONE | Claude + Codex review | Scope binding and catalog snapshot regression; 215 tests/build PASS |
| P03-03 | DONE | Codex | Runtime guards + VE-009; 236 tests/build/compiled smoke PASS; docs/handoffs/P03-03.md |
| P04-01 | DONE | Claude + Codex review | Three findings fixed by owner; independent isolated integration 24/24 PASS; docs/reviews/P04-01.md |
| P03-04 | DONE | Codex | Typed scoped session input/approval/revise/resume; 285 tests/build/export/compiled smoke PASS |
| P04-02 | DONE | Claude + Codex review/fixes | Enforced fencing/DB-time expiry, generation-bound idempotency, audit checks, explicit wake; docs/reviews/P04-02.md |
| P04-03 | DONE | Claude + Codex review/fixes | Immutable inputs, server access and database-time expiry; docs/reviews/P04-03.md |
| P04-04 | DONE | Claude persistence + Codex review/application/integration | Atomic execution journal, fenced restore/cancel/heartbeat, exact approval/input resume, actual OS-kill tests; docs/reviews/P04-04.md |
| P05-02 | DONE | Claude + Codex review/fixes | Owner/args snapshots, catalog-race guard, total deadline/cleanup; docs/reviews/P05-02.md |
| P05-01 | DONE | Claude + Codex review/fixes | Scoped bounded replay, stream deadline, safe failures/usage; docs/reviews/P05-01.md |
| P05-03 | DONE | Claude + Codex review/fixes | Pending/live authorization, revoke/close races, refresh, immutable prompt selection; docs/reviews/P05-03.md |
| P05-01b | DONE | Claude + Codex review/fixes | Extension: bounded OpenAI streaming/usage/errors/config; 12 contract tests; live key/model absent; docs/reviews/P05-01b.md |
| P05-04 | DONE | Codex integration | Engine composition, schema validator, owner-routed discovery and actual SDK/HTTP+stdio MCP/PostgreSQL E2E; docs/handoffs/P05-04.md |
| P06-01 | DONE | Codex integration | 11 authenticated HTTP operations, atomic start/input/approval, scoped connections/snapshots/cursors/context/media, migration 0008; docs/handoffs/P06-01.md |
| P06-03 | DONE | Codex lane W | Bounded worker host, fenced durable cooldown, expiry wake, cancellation without setup, shutdown and OS-kill recovery; docs/handoffs/P06-03.md |
| P06-02 | DONE | Codex lane V | Historical public event projection, scoped replay/retention, bounded SSE/auth/backpressure and atomic producer facts; docs/handoffs/P06-02.md |
| P06-04 | DONE | Codex lane X | Bounded headless HTTP/SSE client/examples, observable audit usage and full-stack workflow contracts |
| P07-01 | DONE | Codex lane Y | Bounded context, complete turns, extractive checkpoints, API report and OS-kill/approval/input regressions |
| P07-02 | DONE | Codex lane Z | Scoped search/user notes, migration0011, CAS/audit/delete, bounded fresh evidence and SDK/MCP tests |
| P07-03 | DONE | GPT lane AA | Reviewed feedback/proposals, exact confirmation, atomic note/audit/retirement, migration0012 and OS-kill tests |
| P07-04 | DONE | GPT lane AB | Scoped advisory checklist opt-in/default off, bounded user evidence, paired ablation/report, restart/budget tests |
| P08-01 | DONE | GPT lane AC | Regression CLI/source+installed dependency/config manifests, raw suite/trial evidence, cold/warm metrics and critical coverage |
| P08-02 | DONE | GPT lane AD | Verified comparison imports/pairing/statistics, coverage/protocol/actual report; external captures NOT_MEASURED |
| P08-03 | DONE | GPT lane AE | Standalone host/probes, packaged SQL/schema-before-polling, clean install/DB and operations runbook |
| P08-04 | DONE | GPT lane AF | Five reproduced code defects fixed, dependency advisories patched, final regression/clean setup and controlled-pilot release review |

## Handoff

Workers follow [parallel development](parallel-development.md) and write docs/handoffs/<task>.md.
Integration owner updates shared checklist/progress only after evidence/acceptance review.
Source utility reuse provenance remains in [reuse inventory](reuse-inventory.md).

## Earlier evidence

Detailed completion evidence through the P04-01/P05-01/P05-02 review is preserved in
[historical integration ledger](progress-history-2026-11-16.md). Task handoffs/reviews retain scope and limits.

## Earlier durable/composition evidence

P04/P05, P06-01/03 and P07-02/03 completion/review evidence preserved intact in [archive](progress-history-2026-11-17.md).

## P06-02 completion

- User authorized continuation. Added small contracts/events, application/events, PostgreSQL
  replay/fact reader, entrypoints/http/sse and bootstrap/event-replay components. HTTP now
  exposes all 12 v1 operations; stream:false disables SSE and its capability together.
- Read-only owner/cursor/namespace/expiry/future/retention/gap admission, contiguous durable
  replay, explicit allowlisted historical projection and schema/byte-safe SSE serialization.
  Bounded sessions/pages/bytes/drain timeout, heartbeat, periodic same-principal auth and preClose.
- Producer fixes: step/tool outcome facts in existing atomic boundaries, transition revision,
  immutable message/proposal refs and approval notification committed with actionable pause.
  Earlier approval/input facts stay unchanged after decisions/resume; private metadata excluded.
- Migration 0010 preserves event allocation against run high water after full prefix pruning;
  no new table/dependency/dataset change, earlier checksums untouched. No historical backfill.
- Full check: 213 unit + 141 contract = 354 PASS; all type/lint/architecture/docs/fixture gates PASS.
  Build/OpenAPI and compiled public SSE/capability/auth/close + worker/HTTP/engine smokes PASS.
- Isolated PostgreSQL: 131/131 PASS, 18 new cases plus all earlier 113. Actual sockets, immediate
  input/approval, cursor/gap/prune/expiry, private actual-SDK/MCP replay, unknown/failed/cancelled,
  heartbeat/auth/quota/shutdown and no repeat execution on reconnect. Review cluster stopped.
- Five unit + two contract cases add real Writable backpressure/listener cleanup, no polling
  ahead of drain, framing injection/byte limits, session accounting/lifetime and capability bounds.
- Direct reuse P02/P04/P06-01; no new legacy copies, .env/key access, live provider, app/dev/V4
  DB, deployment or production migration. Deltas not emitted; durable final/history repairs text.
  Physical retention cleanup/pool/network/operations policy remains host/P08 work.
- 27/36 DONE; P06 is 3/4 DONE. P06-04 headless integration examples READY (lane X); P07 waits
  for it. Stream guide/handoff/review document protocol, evidence, migration and actual limits.

## P06-04 completion

- User authorized continuation. Delivered contracts/client, adapters/http-client, application/client,
  bootstrap/client and public factory/DTOs. Small components; no Next.js/desktop dependency.
- Strict requests/additive response schema, header bearer and safe errors, bounded UTF8/JSON/SSE,
  separate header/idle deadlines, no incomplete/delta cursor, cleanup on abort/break. No write retry.
- Bounded read reconnect/dedup/order checks, consistent snapshot recovery and terminal usage read.
  Host persists checkpoints after apply; no tool/model/approval/input action on observer reconnect.
- Optional RunSnapshot.usage from existing model audit inside RR snapshot; attempts, provenance,
  per-field unknown null and mixed source. No billable request/cost assertion or schema migration.
- examples/headless.ts covers new task/input/exact approval/pause, with trusted injected callbacks.
  Runnable example:headless uses isolated DB/real sockets/worker/MCP/scripted SDK. Demo PASS:
  completed, 3 model attempts, provider 30/15/45 tokens and exactly one approved fixture write.
- Full check: 237 unit + 142 contract = 379 PASS; type/lint/architecture/docs/fixture gates PASS.
  Build/OpenAPI and compiled public client/SSE/worker/HTTP/engine smokes PASS, zero failures/skips.
- PostgreSQL 139/139 PASS: eight new headless cases plus earlier 131. Actual socket reconnect,
  read chain/approved write, clarification, pause without grant, error/partial/failed/unknown,
  mixed/missing usage and no repeat effect on reconnect. Cluster stopped; viper_it_* only.
- Review corrected fixture assertions for failed-versus-partial and allowed model summary after
  unknown (write still once). One reason expression reused in Workin doc seed to satisfy lint;
  seed never executed. Details in handoffs/P06-04.md, reviews/P06-04.md and headless-client.md.
- Direct P02/P01/P04/P06 reuse; no new legacy copy/dependency/dataset, app/V4 DB/.env/key access,
  live provider or deployment. Current migrations remain 0001..0010; no production change.
- 28/36 DONE; P06 4/4 DONE. P07-01 dependency-ready and unclaimed. No comparison superiority,
  desktop SDK, delegated agents or production operational readiness claimed by fixture evidence.

## P07-01 completion

- User authorized continuation; contracts/context, agent/context and narrow runtime preparation
  add text/byte ceilings with output/framing reserve. Original history validated first; active run,
  recent complete turns, paired parallel results and unknown evidence stay intact. No context rewrite.
- Bounded extractive prefix sample is user-role untrusted data; no summarizer model or new grant.
  Original IDs, ledger, approval and execution budgets remain authoritative when old messages omitted.
- Optional runtime state v1 context budget/checkpoint persisted atomically at model-start under lease/
  CAS. Source/binding/safe boundary verified before approved tool resume. Anchor/policy retained
  through clarification/restart; corrupt context blocks writes while explicit cancel still settles.
- Optional RunSnapshot.context exposes only counts/estimate flags. No private excerpt/digest/new
  request authority/event types. No new dependency/table/migration; earlier 0001..0010 unchanged.
- Full check: 257 unit + 143 contract = 400 PASS, zero skips/failures; type/lint/architecture/docs/
  fixture gates PASS. Build/OpenAPI and compiled public context/client/SSE/worker/HTTP/engine PASS.
- Isolated PostgreSQL 145/145 PASS, six new cases plus all 139 retained. Actual SDK/MCP/HTTP,
  exact approved effect once after restart, input anchor, stop before model audit, corruption/cancel
  and actual OS-kill after atomic context commit. viper_it_* only, review cluster stopped.
- context:report reproducible fixture: first JSON bytes 50070 -> 1540, text tokens 11705 -> 298;
  second bytes 50349 -> 1819; model2/tool1 and scripted result unchanged. Live quality/billing and
  V4/Hermes NOT MEASURED; no .env/key/app/V4 DB/live provider/deployment access in P07 task.
- Review fixes: symbol-free identity fingerprint, original-run anchor, source verification before
  recovery, complete Unicode/escaped summary byte cap and zero-counter schema. Former zero omission
  bug explains Workin WIP HTTP/watch symptom; real Workin rerun not claimed. Read WORKIN-LIVE triage.
- Direct P01/P02/P04/P06 reuse, no new legacy copies. P00 evidence archived without deletion to
  keep this ledger below 300 lines. 29/36 DONE; P07 1/4 DONE, P07-02 dependency-ready/unclaimed.

## Workin rejection follow-up

- Exact user-declined evidence distinct from permission/MCP errors; no retry/grant or API migration.
- Sticky rejection under relaxed policy, in-memory terminal TTL, report restore and OS-kill verified.
- 408 offline + 148 isolated PG PASS; build/export/public smokes PASS, no .env/key/app DB/live calls.
- Detailed scope/compatibility/limits in handoffs/WORKIN-REJECTION.md. DAG stays 29/36; MCP session/
  resource-error fixtures recommended next. Actual WL-001/WL-014 live revalidation remains pending.

## P07-04 completion

- DONE, GPT, 2026-11-17; user authorized continuation. Dependency P07-03 DONE.
- Scope: experimental bounded host checklist through existing scoped user-role evidence; baseline
  loop remains default. Scripted paired quality-preservation/usage ablation; live benefit unmeasured.
- No new planner model, execution authority, schema, mandatory registry, source rewrite or desktop.
- contracts/planning plus application/bootstrap provider and root exports add a closed version1
  advisory checklist. Max8 steps/512-byte text/6144-byte plan/8192-byte escaped message, ordered
  acyclic references, immutable scope/plan snapshot and owner/conversation/run-bound SHA256.
- Existing user-role evidence carries the data under deadline/context budget; canonical history,
  checkpoints, system instructions, public API and existing approval/call authority stay separate.
  Host reconstructs/selects plan versions after restart; no persistent execution cursor promised.
- planning:report: six fixed-response cases x3 paired repeats, alternating order;18/18 invariant
  pairs PASS. Model33/tool15 per variant; input bytes22332 ->62493, approximate text2196 ->9594.
  Raw requests/config/budgets/order retained; manifest hashes actual source/support/package and
  refuses source drift during trials. Live quality/billing/provider/cold-warm latency NOT MEASURED.
- Decision: baseline loop remains default; checklist opt-in/default off. Automatic planning deferred
  because no measured semantic benefit justifies overhead. No benchmark/comparison win claimed.
- Full check:285 unit +152 contract =437 PASS, zero failures/skips; type/lint/architecture/docs/
  fixture gates PASS. Build/OpenAPI and all9 compiled public factory/provider smokes PASS, no I/O.
- Isolated PG174/174 PASS, three new planning cases: real SDK/MCP role/history privacy, host plan
  replacement across approval restart still writes original count5 exactly once, budget exhaustion
  before model audit/tool dispatch. Cluster stopped; random viper_it_* only. Ten new unit cases.
- Combined tree also includes four concurrent schema-readiness cases. Integration corrected their
  Fastify thenable assertion, moved schema guard branch into onReady to meet complexity10, and
  set schemaCheck:false for explicit no-DB capability fixtures/smokes. Planning source unchanged.
- Repeated whole-suite runs exposed old100ms headless timeout fixture (173/174; isolated4/4PASS).
  Discovery shares that budget; fixture now1500ms/5000ms delayed result with original unknown/
  effect-once/replay assertions. Production policy unchanged; final PG verification concurrency4.
- Direct P01/P02/P04/P07 context/evidence reuse, no migration/dependency/legacy copy/key/.env/live
  provider/app/V4 DB/deployment access. Source/function caps retained. P06-01/03 history archived
  intact to keep progress below300 lines. Guide/report/handoff/review document limitations.
- 32/36 DONE; P07 4/4 DONE. P08-01 dependency-ready/unclaimed; actual regression manifests/raw
  evidence next, automatic planning and desktop/delegation remain deferred.

## P08 historical evidence

P08-01/02/03 claims/completion retained intact in [archive](progress-history-2026-11-18.md).

## P08-04 claim

- IN PROGRESS, GPT,18 November2026; user authorized comprehensive audit and bug fixes.
- Review correctness, scope/approval/recovery, model/MCP adapters, persistence, API/events,
  context/learning, maintainability, operations and future desktop boundaries; no deployment.
- Preserve cache support and concurrent Workin integration changes; isolated fixtures/DB only.

## P08-04 completion

- DONE, GPT,18 November2026. Risk-based audit across durable/approval/lease/storage, model/MCP,
  API/events/client, context/recall/learning, ops, maintainability and future desktop boundaries.
- Five reproduced defects fixed: caller-clock takeover/backdated renewal; missing proposal lease
  admission; truncated migration suffix false readiness; retained MCP session after owner access
  disappears; contradictory Anthropic stop/content. Six new regression cases, before/after logs.
- Schema version13 pinned in bootstrap; build/migrate/readiness enforce it. No migration rewritten/
  added or API operation changed. Actor decisions remain separate; valid journal proposals carry lease.
- Dependency advisories fixed via pinned Ajv8.18.0/tsx4.23.15, resolved esbuild0.28.2; audit after0.
- Final full check312 unit +159 contract =471 PASS; PG182/182 +60/60 engine trials PASS,6 critical
  groups PASS; build/OpenAPI/9 public smokes PASS. Raw/current source hashes verified, no drift/
  cleanup errors. Review50568 stopped, only random viper_it_* DBs; no .env/provider/app DB access.
- Final raw artifact: artifacts/evals/regression-2026-11-17T17-39-21-123Z-1c3ec153; current compare
  comparison-2026-11-17T17-43-13-443Z-402803a7 remains INCONCLUSIVE, external captures unmeasured.
- Clean source copy artifacts/p08-04-clean-0806c0f8: npm ci offline167 packages; build/check471/
  compiled fresh-DB smoke PASS, source hashes match and .env absent. Combined verification metadata
  in artifacts/p08-04-verification.json; AST272 source files, max186/runtime103/function40/complexity10.
- docs/release-review.md, reviews/P08-04.md, reports/P08-04-release.md and handoff record findings,
  actual logs, retained default-off extensions and remaining live/production/large-scope evidence.
- 36/36 DONE, P08 4/4. READY_FOR_CONTROLLED_PILOT; no next R2.1 task. Follow-up: authorized live
  acceptance/pilot and deployment load/restore/identity/runtime validation; no production or
  Hermes superiority certification. No commit/tag/deploy/desktop/delegation/legacy rewrite.

## Local tool discovery extension claim

- IN PROGRESS, GPT,18 November2026; user authorized env auto/on/off and sensible scalable discovery.
- Own contracts/discovery, agent/discovery, context projection/runtime hooks, checkpoint state,
  bootstrap/env wiring, matching tests and TOOL-DISCOVERY handoff. R2.1 remains36/36.
- No native provider API migration, live provider/key/app DB, new dependency/migration or desktop.

## Local tool discovery extension completion

- DONE, GPT,18 November2026. Backend authorized catalog separated from model-active real schemas.
- Env auto/on/off, count OR token thresholds, bounded local BM25/source filter, active/search caps.
  Typed MCP execution/argument validation/exact approval/journal remain the business dispatch path.
- Existing execution JSON saves settings/effective mode, counter, versioned active refs and private
  paired exchanges; correct projection/compression without canonical history/notes/public results.
- Fixed review finding: in-memory input/approval refresh rebuilt an eager index. Shared controller
  restoration now preserves visibility/version checks; two negative resume cases verify no hidden call.
- Full check325 unit +161 contract =486 PASS; PG184/184 +60/60 engine trials PASS, no source drift/
  cleanup errors. Build/export/10 compiled public smokes PASS;13 SQL assets,12 operations unchanged.
- Raw capture artifacts/evals/regression-2026-11-17T18-37-28-601Z-4cee403d; raw/current source hashes
  verified in artifacts/discovery/verification.json. Review50568 stopped; random viper_it_* only.
- discovery:report400/1000/3000 synthetic catalogs: initial1 schema, selected2. Approximate structural
  sizes only, not measured live reasoning/Indonesian recall/cache/billing/latency or superiority.
- AST283 source files, max186/runtime109/function40/complexity10; no dependency/migration/legacy
  copy or .env/provider/app DB access. Existing36-task DAG unchanged; desktop/delegation deferred.
- Guide docs/tool-discovery.md and handoff/reports/tool-discovery document explicit host env wiring,
  pinned run settings and limits. Next relevant validation: realistic Workin+Margin bilingual live eval;
  provider-native/semantic search depends on evidence, with no deployment or live calls in this slice.
- Workin live-eval now injects env config and pins nonsecret resolved discovery settings in its
  manifest; full catalog token count is labeled as a baseline. Static wiring check only, no live run.
