# Progress and handoff ledger

## Current state - R2.1

- Tanggal: 17 November 2026, Asia/Jakarta.
- P00 foundation: DONE (P00-01, P00-02, P00-03, P00-04).
- Primary stack: strict TypeScript/Node ESM/PostgreSQL/Fastify; P07-04 bounded planning adalah next DAG task.
- Context/API schemas, durable driver, model/MCP E2E, HTTP control, worker dan SSE/replay tersedia.
- P04-01 Claude DONE setelah temuan diperbaiki owner dan 24 integration tests lulus review ulang.
- Utility adoption berjalan per P02 handoffs; legacy database tidak diakses atau diubah.
- V4/Hermes benchmark: NOT MEASURED. Desktop/delegation/legacy migration: DEFERRED.
- P00/P01/P02/P03/P04/P05/P06 dan P07-01/02/03 DONE (31/36).
- OpenAI P05-01b extension reviewed/DONE; tidak menambah task DAG. Live OpenAI smoke belum dijalankan.
- Latest gates: check 427 unit/contract tests, build/export/public learning+recall+context+client/HTTP/SSE/worker/engine PASS; isolated PostgreSQL 167/167 PASS.
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

## Handoff

Workers follow [parallel development](parallel-development.md) and write docs/handoffs/<task>.md.
Integration owner updates shared checklist/progress only after evidence/acceptance review.
Source utility reuse provenance remains in [reuse inventory](reuse-inventory.md).

## Earlier evidence

Detailed completion evidence through the P04-01/P05-01/P05-02 review is preserved in
[historical integration ledger](progress-history-2026-11-16.md). Task handoffs/reviews retain scope and limits.

## Earlier durable/composition evidence

P04/P05 completion and review evidence preserved in [archive](progress-history-2026-11-17.md).

## P06-01 completion

- User authorized continuation. Added createEngineHttpServer over small entrypoints/http and
  application/api components, typed control/storage/cursor ports, safe errors and PostgreSQL
  API control/connection adapters. All 11 non-streaming v1 operations; no SSE/poller daemon yet.
- Start returns 202/queued without model/tool execution. Atomic run/message/event/instructions/
  dedup commit, locked active-conversation admission, canonical resource-scoped idempotency,
  clarification receipts before stale revision, exact approval decision plus explicit wake,
  idempotent cancel and scoped connection create/list/CAS revoke verified.
- Host-verified Bearer identity only; foreign actor/tenant/private IDs hide details. Request IDs
  generated by server. Context first checks owned ready connections; host must authorize URI/
  prompt policy. Reference media requires scoped host grant. Private prepared system context
  loads via trusted async worker instructions and never appears in public history.
- Self-review fixes: atomic dedup failure boundary, control-input lease distinction, framework
  params/query normalization, approval lock/revision ordering, full encoded ID allowance,
  signed owner/kind/resource cursors and lossless bounded public content projection.
- Migration 0008 adds immutable run_instructions/input_receipts with owner FKs; 15 engine
  tables plus migration ledger. Earlier files/checksums unchanged; no application migration.
- Direct reuse: P02 deadlines/fingerprints, P04 transactionPool/reviewed stores/SQL guards and
  P05 engine. No new legacy copies, taxonomy, .env or credential reuse. Fastify 5.12.8 pinned,
  42 packages installed with ignore-scripts/no-audit/no-fund using project npm cache.
- Full check: 198 unit + 139 contract = 337 PASS; type/lint/architecture/docs/fixture gates PASS.
  Build/OpenAPI export and compiled public HTTP/auth/close + engine smoke PASS.
- Isolated PostgreSQL: 104/104 PASS (18 new HTTP cases plus all earlier 86). Includes actual
  socket disconnect, subsequent worker completion, retries after restart, context consumed by
  actual SDK engine, URI grants, multi-approval, rollback, cursor paging and ownership/CAS.
  Zero failures/skips; generated viper_it_* DBs only; review cluster stopped.
- No live provider/app/dev/V4 DB, secret edit or deployment. Auth/grant/context/media adapters
  are host responsibilities. HTTP guide/handoff/review record limits and exact next work.
- 25/36 DONE. P06-02 SSE/event projection and P06-03 worker host are now parallel-ready;
  claim lanes V/W and coordinate shared bootstrap. P06-04 waits for both. Neither started here.

## P06-03 completion

- User authorized continuation; Codex claimed worker lane W, leaving SSE source/route ownership
  untouched. Added small application/worker components, bootstrap/worker and explicit signal
  entrypoint; createEngineWorker stays idle until start/runWorkerUntilSignal is called.
- Bounded delivery slots, idle polling, local exponential backoff, isolated maintenance,
  safe observer/status, idempotent lifecycle and actual drain/timeout distinction. SQL pool
  remains host-owned; HTTP/client lifetime is independent from worker execution.
- Migration 0009 adds run_deliveries; failed work schedules under its live owner/fence before
  release, with database-time retry admission and longer auth/config cooldown. Cancellation
  bypasses cooldown and no longer depends on healthy MCP/model configuration for cleanup.
- Maintenance uses run-first locks/SKIP LOCKED, expires due proposals and explicitly wakes in
  one transaction; fresh pending siblings keep the run paused. No maintenance tool dispatch.
- Review fixes include poison-run starvation, cancellation behind auth failures, heartbeat
  rescheduling after shutdown/loss, timeout versus actual drain, duplicate saved instructions
  and race-safe expiry wake. Details: reviews/P06-03.md, guide: worker-host.md.
- Full check: 208 unit + 139 contract = 347 PASS; type/lint/architecture/docs/fixture gates PASS.
  Build/OpenAPI and compiled public worker/HTTP/engine smokes PASS. No size/complexity exception.
- Isolated PostgreSQL: 113/113 PASS, nine new cases plus all previous 104. Two polling hosts,
  auth cooldown across restart, stale/idempotent fences/DB clock, actual MCP effect recovery,
  actual OS-killed polling host, expiry concurrency and shutdown-timeout heartbeat regression.
  Zero failures/skips; generated viper_it_* DBs only; review cluster stopped afterward.
- Direct reuse P02 deadlines/delay/fingerprints and P04/P05/P06-01 components; no legacy copy,
  new dependency or evaluation dataset change. Earlier migration checksums unchanged. Current
  engine needs 0009; no app/dev/V4 migration, .env/key access, live provider or deployment.
- 26/36 DONE; P06 has 2/4 tasks DONE. P06-02 SSE/reconnect remains READY, lane V unclaimed.
  P06-04 waits for SSE. Worker task is complete; no desktop/delegation/benchmark claim added.

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

## MCP session follow-up and P07-02 completion

- User authorized both. SDK HTTP404 retires stale session/catalog; later acquire reauthorizes and
  initializes anew, no request replay. Resource/read -32002 maps to sanitized not_found only there.
  Three actual protocol cases include tool error -32002 remaining unknown and healthy resource session.
- contracts/application/bootstrap recall service provides owner/app/tenant-scoped literal text search,
  explicit user-source notes, provenance, CAS correction/delete and immutable metadata audit. No
  generated answer promoted to fact; source role/owner enforced by FK. New migration0011 only.
- Optional ContextEvidenceProvider reloads user-role data per model call under deadline/budget.
  No canonical history/checkpoint/grant copies or automatic note writes; corrected/deleted evidence
  changes on next lookup. Note deletion does not delete immutable source history or audit metadata.
- Full check: 271 unit + 146 contract = 417 PASS, zero failures/skips; type/lint/architecture/docs/
  fixture gates PASS. Build/OpenAPI and compiled public recall/context/client/HTTP/SSE/worker/engine PASS.
- Isolated PostgreSQL 154/154 PASS: six new recall cases plus all148. Actor/app/tenant isolation,
  raw FK/generated-answer refusal, literal injection input, CAS race, source size, audit immutability,
  tombstone and actual SDK/MCP correction/delete between model calls. Cluster stopped, viper_it_* only.
- example:recall PASS: completed, search1/model2/tool1, zero remaining notes, three audit revisions.
  No .env/key/live provider/Workin/app/V4 DB/deployment access. Latest schema11 migrations/18 tables
  plus ledger; older checksum bytes untouched. No dependency or core scenario/dataset change.
- Direct P01/P02/P04/P06 reuse. P04/P05 evidence archived intact to preserve active doc cap. Recall
  is host-library API, no new HTTP CRUD or desktop. 30/36 DONE; P07 2/4, P07-03 ready/unclaimed.

## P07-03 completion

- DONE, GPT, 2026-11-17; user authorized continuation. Dependencies P07-01/02 DONE.
- Scope: bounded owner-scoped feedback/proposals, explicit review, atomic note promotion and
  feedback revision invalidation. No automatic fact promotion, source rewrite or new HTTP routes.
- contracts/application/bootstrap learning and focused PostgreSQL components expose host-library API;
  no background promotion/model calls, source rewrite, new HTTP routes, executable skills or desktop.
- Proposal creation/review requires current confirmed feedback, clean completed durable checkpoint,
  final assistant message, successful model/tool attempts and complete dispatch audit. Positive
  feedback cannot certify failed/partial/unknown/cancelled runs or missing audit rows away.
- Exact digest/CAS review plus owned post-run user statement matching candidate text creates a
  user_asserted note in the same transaction as acceptance/audit. Pending/rejected stay outside recall.
- Any replacement feedback atomically stales pending/accepted items and retires unedited promoted
  notes; independently corrected/deleted notes retain their user decision. Bounds32 proposals/128
  feedback revisions per run; no background maintenance queue needed. Migration0012 adds3 tables;
  current schema21 engine tables plus ledger. Earlier migration checksums unchanged.
- Full check: 275 unit + 152 contract = 427 PASS, zero failures/skips; type/lint/architecture/docs/
  fixture gates PASS. Build/OpenAPI and all8 compiled public factory smokes PASS, no I/O.
- Isolated PostgreSQL 167/167 PASS, including11 new learning cases. Combined-tree totals include
  concurrent adapter/worker regressions. This task adds2 unit cases and does not own those edits.
- Scope/app/tenant/source checks, dedup/caps, CAS races, raw SQL guards, changed evidence, feedback
  invalidation/preserved corrections and actual SIGKILL before/after commit verified. Cluster stopped;
  random viper_it_* only. Review fixed nullable revision domain, Unicode bounds and cancel-intent test.
- example:learning PASS: completed/model2/tool1, pending -> accepted -> stale, note tombstoned;
  three metadata audit revisions. Guide/handoff/review: outcome-proposals.md and P07-03 documents.
- Direct P01/P02/P04/P07-02 reuse; no dependency/legacy copy/key/.env/app/V4 DB/live provider or
  deployment access. Candidate text/history/audit retained; tombstone is not global privacy erasure.
- 31/36 DONE; P07 3/4. P07-04 ready/unclaimed: optional bounded planning with measured ablation.

## P07-04 claim

- IN PROGRESS, GPT, 2026-11-17; user authorized continuation. Dependency P07-03 DONE.
- Scope: experimental bounded host checklist through existing scoped user-role evidence; baseline
  loop remains default. Scripted paired quality-preservation/usage ablation; live benefit unmeasured.
- No new planner model, execution authority, schema, mandatory registry, source rewrite or desktop.
- Validation pending. Features without measured live benefit remain opt-in/default off.
