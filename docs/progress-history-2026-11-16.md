# Historical integration ledger: 16 November 2026

Preserved evidence from [progress](progress.md); historical status/claims describe their original checkpoints.
Current ownership and validation are authoritative in progress.md.

## P00 completion handoff

- Owner: Codex integration, 16 November 2026 (Asia/Jakarta); authorized scope P00 only.
- Build/config: package/lockfile, compiler configs, src/bootstrap/config.ts, src/index.ts.
- Engineering: scripts/lib AST/dependency/docs checks, CLI runners and positive/negative tests.
- Evaluation: evals schemas/catalog/scenarios/support/rubric/manifest, strict contract validation.
- CI: .github/workflows/ci.yml, Windows/Ubuntu project-root template; no remote run claimed.
- No P01 contracts, database provisioning, live providers or desktop implementation started.
- No utility source adopted yet; P02-01 can inventory independently of P01-01.
- Shared config/exports/checklist/progress/manifest remain integration-owner owned.
- Next: assign P01-01 and P02-01 to different agents using parallel-development.md prompts.

## Completed batch: P01-01 + P02-01

- User authorized continuation after P00; both dependency-ready tasks claimed by separate agents.
- identity_contracts owns src/contracts/identity/, src/contracts/messages/ and matching tests.
- utility_manifest owns docs/reuse/P02-01.md; source legacy dibaca tanpa diubah.
- Workers write task-specific handoffs; integration owner retains shared configs/status/exports.
- Both tasks passed integration review and validation; shared checklist updated to DONE.

## P01-01 / P02-01 integration evidence

- `npm.cmd run check`: PASS, 45 unit + 9 contract = 54 tests, zero failures/skips.
- `npm.cmd run build`: PASS; typecheck/lint/architecture/docs all clean.
- Compiled package-export smoke: PASS for trusted scope override rejection and tool-call/results.
- 10 contract modules, largest 75 physical lines; no SDK/database/framework imports.
- 17/17 reuse source hashes and physical line counts independently rechecked by integration owner.
- Root exports curated; parser internals stay private. P00 dataset/source snapshot not rewritten.
- Source utility adoption is still planned, not copied; legacy files/config/database unchanged.
- Auth factory validates trusted identity shape, not credentials. Ingress role authorization,
  MCP catalog/schema policy, payload budgets, persistence and provider adapters remain later work.
- Shared utility clock wiring clarified: composition supplies primitive instants/callbacks;
  no contract import or duplicate Clock interface inside shared.
- Worker handoffs: docs/handoffs/P01-01.md and docs/handoffs/P02-01.md.
- Next four dependency-ready tasks can run concurrently with exclusive lane ownership.

## P01-02 / P02-04 completion (Codex)

- Priority selected to open engine/model/MCP integration while Claude owns P02-02/03.
- P01-02: SDK-free model/MCP ports and 17 new contract tests including P00 compatibility.
- P02-04: preserved wire content/private metadata, exact machine-code evidence, explicit unknown
  execution outcomes, strict canonical JSON and domain/version-separated SHA-256; 18 targeted tests.
- Final `npm.cmd run check`: PASS, 92 unit + 37 contract = 129 workspace tests, zero failures/skips.
- Final `npm.cmd run build` and compiled model/MCP/normalization/fingerprint smoke: PASS.
- Source hashes for S05/S06 verified; MD5/delimited equality implementation rejected.
- No root exports/config/packages or Claude implementation/test files modified.
- Claude contributions are included in whole-tree checks but not claimed as Codex implementation.
- Read-only integration review reproduced token-factor arithmetic overflow in P02-03. Owner fix
  and regression tests are described in [review note](reviews/P02-03.md); task stays unchecked.
- P01-03 remains independent. P03-01 awaits P02-02/03 completion after owner review.

## P02 integration and P03 claim

- User confirms Claude now owns P01-03; Codex integrates the completed utility handoffs.
- P02-02: reviewed explicit retry policy, deadline cleanup/late work and bounded dispatch tests.
- P02-03: fixed finite coefficient arithmetic producing Infinity/unsafe integers; RangeError now
  rejects an invalid computed count. Regression covers both overflow paths and unsafe integers.
- `npm.cmd run check`: PASS, 93 unit + 37 contract = 130 tests; build PASS.
- P02 tasks DONE; provenance and original Claude implementation attribution retained.
- P03-01 dependencies now DONE. No production state/store ports duplicated while Claude owns P01-03.

## P03-01 completion

- Context assembler validates scope/conversation, trusted instruction placement, complete
  tool-result pairing, capabilities/deadline and immutable model-facing snapshots.
- Text/schema estimate reuses P02-03 and explicitly excludes media prices/provider framing.
- Scripted ModelGateway, typed fake MCP bridge over existing P00 service, deterministic
  Clock/IDs and scoped revisioned in-memory history fixtures live under tests/support/agent/.
- Added 11 unit + 8 contract tests: scope isolation, instruction authority, immutable snapshots,
  pairing/error/unknown/empty evidence, script exhaustion/cancel, MCP checks/resources/prompts,
  and repeatable final-only/single-tool/two-tool-chain context replays.
- Final `npm.cmd run check`: PASS, 122 unit + 45 contract = 167 tests, zero failures/skips;
  typecheck/lint/architecture/docs clean. `npm.cmd run build`: PASS.
- Whole-tree counts include Claude's P01-03 tests, whose integration review is still pending.
- No edits to Claude's state/schema/tests; no DB, real provider/MCP, HTTP or desktop work.
- Root exports/packages/config and P00 fixture hashes/source snapshot unchanged.
- P03-02 READY; P01-04/P04-01 wait for P01-03 review. Handoff: docs/handoffs/P03-01.md.

## P01-03 integration / P01-04 claim

- Reviewed state transitions, ownership-before-conflict, unknown outcome evidence, single-use
  approval binding, store transaction requirements and fresh-schema ADR/tables/spec drift tests.
- Added guards for event sequence/revision arithmetic beyond MAX_SAFE_INTEGER, with regression.
- `npm.cmd run check`: PASS, 123 unit + 45 contract = 168 tests; build PASS.
- P01-03 DONE. PostgreSQL/migrations/atomic storage enforcement remain P04, not claimed here.
- User accepts Claude's suggestion: Codex claims P01-04 API schemas; P03 runtime paths remain free
  for the coordinated agent. No edits to runtime or database implementation in this task.

## P01-04 completion

- 41 frozen JSON schemas, OpenAPI 3.1.1 for 12 operations across 11 paths, typed payloads for
  all 13 durable events plus separate ephemeral delta; no desktop/legacy routes.
- Strict authority boundaries, user-only input shapes, public message projection, full approval
  comparison, safe revision/idempotency/cursor bounds and structured error recovery.
- 18 new contract tests cover valid/invalid requests/responses/events, local refs/export parity,
  schema/state enum sync, negative authority cases and official offline structural validation.
- Official schema/license pinned with provenance; test-only static fallback adaptation for
  Ajv 8 non-root dynamic-anchor resolution is documented, not hidden or applied to payload schemas.
- Final `npm.cmd run check`: PASS, 140 unit + 73 contract = 213 tests; zero failures/skips.
  Typecheck/lint/architecture/docs clean; `npm.cmd run api:export` builds and writes artifact.
- Compiled public API/exported artifact equality smoke PASS. Public exports include documents
  and stable error status/code types; no framework/validator dependency added to contracts.
- New docs/api/README.md specifies versioning, dedup scope, replay semantics, body bounds,
  projection and remaining P06 responsibilities. Handoff: docs/handoffs/P01-04.md.
- No HTTP/auth/storage/cursor codec/live APIs implemented. No runtime/execution files modified.
- Claude's P03-02 handoff is pending review; its tests are included in whole-tree totals.
- P04-01 is dependency-ready after P01-03 review. P03-03 waits for P03-02 integration.

## P03-02 integration / P03-03 claim

- Reviewed pairing, awaited dispatch intent, unknown/partial evidence, exact alias validation,
  approval holding and deterministic fixture runtime tests.
- Fixed catalog scope against run actor/app/tenant and deep snapshots of connection/ref/schema.
- Combined check/build PASS: 142 unit + 73 contract = 215 tests. Persistence remains Claude-owned.
- P03-02 DONE. Codex claims P03-03; no package install or persistence changes in this lane.

## P03-03 completion

- Added immutable host limits, per-invocation step/tool/output counters, canonical repetition
  detection and unknown-call suppression; preserved existing model attempt/token allowances.
- Real timers bound async model/tool waits even when gateways ignore AbortSignal; injected clock
  handles deterministic expiry. Rechecks before/after awaited intent prevent dispatch after stop.
- Oversize output is omitted while success/error/unknown execution evidence stays accurate;
  remaining calls get not-dispatched feedback with complete pairing. No automatic gateway retries.
- Report dispatchState distinguishes not_sent even after an intent event; P04 must settle such
  attempts with known_not_applied rather than forbidden dispatching -> cancelled transitions.
- Added 20 unit + 1 contract tests: limits/repetition/unknown writes, output UTF-8/token/aggregate
  bounds, caller mutation, async timeout/cancel/late results, intent/approval races and cleanup.
- VE-009 real fixture executes once and returns expected failed/repetition_limit; repeated runs
  produce identical results/events. P00 dataset/manifests were not changed.
- Final `npm.cmd run check`: PASS, 162 unit + 74 contract = 236 tests; zero failures/skips.
  Typecheck/lint/architecture/docs clean; build and compiled bounded-runtime smoke PASS.
- Adopted P02 deadline/timer and SHA-256 helpers via direct imports; no new copied legacy source,
  credentials, installs or package/root export changes in this task.
- Durable sinks remain awaited; their I/O bounds and cross-restart budget/ledger restoration
  belong to P03-04/P04. Counters here are per invocation, not a claim of durable recovery.
- P03-04 READY after this handoff; P04-01 Claude handoff pending review, integration not rerun here.

## P04-01 review / P03-04 claim

- User requests review only for persistence, then continuation. Repository/migration source unchanged.
- Independent isolated PostgreSQL integration: 17/17 PASS (SQL suite 45/45); four additional
  real-store cases expose three findings recorded in docs/reviews/P04-01.md. P04-01 stays unchecked.
- No application/dev/V4 DB used. Temporary review cluster only; runtime work remains offline.
- Codex claims P03-04; P05-02 MCP transports remain Claude-owned. No provider credentials needed.

## P04-01 re-review / P03-04 completion

- Claude corrected all three review findings. Reviewed run admission, consumption-only dispatch,
  named constraints/migration 0003 and seven regression cases. No persistence implementation
  modified by Codex. Independent re-review: 24 PostgreSQL integration tests PASS, SQL 45/45.
- Explicit review-only VIPER_TEST_DB_* configuration; no .env loaded, no application/dev/V4 DB
  used. Temporary cluster stopped in finally. P04-01 DONE after combined gates.
- P03-04: scoped in-memory AgentRunSession with typed input/approval actions, dedup/CAS/busy
  protection, exact-argument snapshots, new identities on revision, acceptance separate from
  dispatch, expiry/catalog/current-policy checks and single-use consumption.
- Pauses preserve the same budgets/history/model counts/deadline and completed/unknown evidence;
  only unanswered calls resume. Added maxCorrections and final synchronous admission after intent.
- API ApprovalView now requires concrete arguments (pre-release P01-04 refinement before HTTP).
- Added 21 workflow unit + 3 real-fixture contract tests including VE-004 input completion,
  VE-008 approved write, MCP failure after clarification, concurrent resume, identity/scope,
  revised parameters, changed permissions/version, intent-time expiry and poisoned sink behavior.
- Final `npm.cmd run check`: PASS, 188 unit + 97 contract = 285 tests; zero failures/skips;
  lint/architecture/docs clean. `npm.cmd run api:export` build + artifact PASS.
- Compiled approval-session smoke PASS: acceptance dispatches nothing, resume dispatches one
  exact call and finishes with counters retained. Concurrent provider/MCP code is counted in
  whole-tree tests but its tasks remain separately owned/reviewed.
- P03 offline milestone DONE. Session state is ephemeral; P04-02/03/04 still own durable leases,
  approval transactions and checkpoint/restart recovery. No new provider credentials/live calls.

## P04-01 / P05-01 / P05-02 review batch

- User authorized fixes and confirmed MCP files handed over. P04-01 remains approved; its three
  corrected admission/approval/constraint findings passed another combined-tree regression run.
- P05-01: fixed cross-owner opaque thinking replay via scoped context/history fingerprints,
  deep immutable byte-bounded cache, whole-stream/observer deadlines, safe failure messages,
  completion/usage validation and zero default SDK retries. 13 Anthropic contract tests PASS.
- P05-02: snapshot owner/ref/args before awaits, reject catalog-generation races before send,
  bound total discovery/dispatch waits and protect session cleanup. 23 MCP contract tests PASS
  including 5 P05-03 pool/access tests, which do not constitute P05-03 review approval.
- Reused existing P02 deadline/fingerprint and contract JSON/usage parsers directly; no new
  legacy copies, root exports, contracts, dependency installs or environment/credential access.
- Independent `npm.cmd run check`: PASS, 188 unit + 119 contract = 307 tests, zero failures/skips;
  typecheck/lint/architecture/docs clean. `npm.cmd run api:export`: build + export PASS.
- `node scripts/run-tests.mjs integration` with explicit isolated review DB settings: 30/30 PASS;
  includes 24 original P04-01 cases, 2 connection-store and 4 current lease cases. Cluster stopped.
- No live model smoke repeated; Claude's earlier smoke remains owner evidence. Review notes:
  docs/reviews/P04-01.md, P05-01.md, P05-02.md. Both P05 handoffs/checklist updated to DONE.
- P04-02's Claude handoff arrived during this review; preserve coordinated persistence ownership.
  Suggested next Codex work: review P04-02 to unlock P04-03; a separate reviewer can review
  P05-03 in parallel. P05-01b is separate. P04-03/04 precede P05-04; no new task started here.
