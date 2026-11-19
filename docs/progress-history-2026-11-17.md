# Durable/composition evidence archive

Moved intact from progress.md during P07-02. Current state is in [progress](progress.md).

## P04-02 / P05-01b / P05-03 review and P04-03 continuation

- User authorized review/fixes then continuation. Requested three handoffs approved; continued
  with Claude's newly handed P04-03 approval-policy review/fixes (dependency P04-02 now DONE).
- P04-02: no omitted-lease bypass after claim, proposal fencing, database-time expiry including
  renew/release, explicit owner/CAS wake, immutable idempotency claim generations and key locks,
  terminal execution admission and safe model audit fields. Six regression integration cases.
- Pre-release ports refined: release(at), complete/abandon(claimId), proposal lease and wake.
  Migration 0006 additive; applied earlier migration/checksum files were not rewritten by Codex.
- P05-01b: total stream/observer deadline + abort, completion/usage validation, safe errors,
  zero default SDK retry and endpoint hygiene. 12 OpenAI contract tests PASS.
- P05-03: scoped pool/open generations, total connect deadline, revoke/close races, held-session
  directory rechecks, post-advertisement admission, immutable prompt selection and later explicit
  refresh after HTTP 401. 30 MCP contract tests PASS; no failed tool automatically replayed.
- P04-03: deep snapshot arguments/schema before awaits, server enabled/private-owner checks,
  database-time proposal/accept/consume/revise expiry. Shared digest constant reused by session.
  Five new actual-store regressions; no HTTP or durable session driver claimed.
- Final `npm.cmd run check`: 188 unit + 132 contract = 320 PASS, zero failures/skips; all limits,
  docs/layer/cycle/type checks PASS. `npm.cmd run api:export`: build + OpenAPI artifact PASS.
- Independent `node scripts/run-tests.mjs integration`: 55/55 PASS using explicit isolated
  review settings (no .env/app/dev/V4 DB). Includes five P04-04 persistence cases; cluster stopped.
- User chose existing OpenAI key reuse; parsed configuration has no nonempty key/model. Initial
  raw presence check counted an empty quoted entry. No live call, key creation or secret edits.
- Reuse: P02 deadlines/fingerprints and contract parsers/constants directly; no legacy copies,
  new dependencies, root adapter exports, dataset changes or production migrations by reviewer.
- Notes: reviews/P04-02.md, P05-01b.md, P05-03.md and P04-03.md. Handoffs/checklist synchronized.
- Next at that checkpoint: complete P04-04 over Claude's persistence half, then P05-04 E2E.
  The later P04-04 completion record below supersedes that incomplete status.

## P04-04 completion

- User assigned Claude's persistence handoff and remaining durable driver to Codex. Prior
  P04-03/P05-01b/P05-03 review dispositions remain DONE; no new live provider work required.
- Persistence review: update run lock before conversation/event append, immutable message
  snapshots, runId required for assistant/tool messages, exact result origin and bounded,
  sequential snapshot reads. Findings recorded in reviews/P04-04.md.
- Added contracts/state/journal.ts, migration 0007/runtime_checkpoints, transaction-bound
  composition over reviewed stores and an atomic journal. Earlier migrations unchanged.
- Added application/durable/ and bootstrap/durable.ts: claim/load, validated versioned restore,
  same absolute deadline/ceilings/counters/fingerprints, heartbeat/cancel polling, approvals,
  amended inputs, terminal cleanup and conservative unknown recovery without tool replay.
- Core adds budget snapshot/restore, optional trusted resume state, decision/report metadata and
  correction boundary; SDK/database dependencies stay outside core. Public bootstrap export added.
- Four real fixture worker process kills verify recovery after effect, report, final message and
  model intent. Other cases cover cancellation/intent rollback, waiting cancellation, heartbeat,
  lost lease, amendment, retained duration/repetition/model ceiling and journal rollback.
- Final `npm.cmd run check`: 190 unit + 132 contract = 322 PASS; zero failures/skips; all limits,
  type/layer/cycle/docs checks PASS. `npm.cmd run api:export`: build + artifact PASS.
- Independent isolated PostgreSQL suite: 73/73 PASS, no warnings. Explicit review cluster and
  generated viper_it_* DBs only; cluster stopped, fixture child processes killed and awaited.
- No .env/app/dev/V4 DB, live model/MCP, dependency installs or dataset changes. Migration 0007
  delivered and tested on review databases; no application/dev migration applied by Codex.
- Reuse: existing P02 deadline/fingerprint helpers, P03 loop and reviewed P04 stores, through
  ports/composition; no duplicate legacy copies. Guide: durable-driver.md, handoff: handoffs/P04-04.md.
- P04 DONE (4/4), 23/36 tasks total. Next dependency-ready task: P05-04 real adapter E2E
  composition. API/action/event projection and daemon polling host remain P06; comparisons unmeasured.

## P05-04 completion

- User authorized continuation. Composed createViperEngine over reviewed P04 durable driver,
  actual model bindings, authorized pooled MCP discovery/aliases, production validator and
  mandatory host policy. Factory/config/type exports are bootstrap-only; no HTTP daemon added.
- Added small bootstrap engine components, pooled-gateway and schema adapter. Reuses P02
  deadlines/fingerprints, existing SDK/pool/aliases and atomic driver directly; no legacy copies.
- Fixed async-schema bypass/cache retention, OpenAI tool-image projection, unsupported audio
  terminal handling and cold-connect/request allowance. Full detail: reviews/P05-04.md.
- Thirteen new DB E2E cases cover actual SDK scripted fetch, real local MCP HTTP/stdio,
  read chain, approved write/new engine, validation, isError, auth/revoke, content, unknown,
  shutdown recovery and same-name multi-connection routing. No tool retry after unknown.
- Production deps Ajv 8.17.1 and ajv-formats 3.0.1 pinned; already installed, lock updated
  offline. Schema compiler is synchronous/no remote loading/no argument mutation. No migrations.
- Final check: 194 unit + 134 contract = 328 PASS, zero failures/skips; all type/lint/architecture/
  docs gates and fixture validation PASS. API export/build and compiled public composition smoke PASS.
- Isolated PostgreSQL: 86/86 PASS after the cold-stdio timeout fix; cluster stopped. Explicit
  review settings/viper_it_* DBs only; no .env, app/dev/V4 DB, live provider or secret changes.
- Guide engine-composition.md and handoff handoffs/P05-04.md describe host integration, defaults,
  error boundaries and actual limitations. Live model compatibility and Hermes/V4 win unmeasured.
- P05 DONE (4/4), 24/36 total. P06-01 HTTP next; P06-02 SSE and P06-03 daemon can split lanes
  after P06-01 DONE. Desktop/delegation remain deferred; no P06 work automatically started.

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

