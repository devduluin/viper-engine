# Development plan R2.1: Viper Engine

Revision R2.1, 16 November 2026. Status task aktual ada di checklist/progress; P00 sudah diimplementasikan.
R2 menggantikan roadmap R1 sebelum implementasi; 9 phase/36 tasks aktif di dokumen ini.
Desktop, delegated agents, migrasi data V4 dan old-UI compatibility tidak menjadi dependency.
Mulai dari [START_HERE](../START_HERE.md). Tracker: [checklist](development-checklist.md).

## Execution protocol

Satu task dengan dependencies DONE per slice. Dependencies per task di
[task-dependencies.json](task-dependencies.json) menjadi acuan, bukan urutan seluruh phase.
Lihat [parallel-development](parallel-development.md) untuk path ownership. Catat progress, implement scope/acceptance,
jalankan checks yang tersedia dan simpan evidence sebelum mencentang task.
Aturan global: source <=300, loop <=180, function <=60, complexity <=10, strict TS dan no cycles.
Command foundation sudah tersedia; lihat [tooling](tooling.md). Scripts integrasi/evaluasi runtime
baru ditambahkan ketika implementasinya ada, tanpa placeholder success.

## Phase map

| Phase | Deliverable |
| --- | --- |
| P00 | Project/tooling/CI dan evaluation fixtures specification |
| P01 | Engine contracts, fresh database blueprint, API schemas |
| P02 | Utility reuse minimum yang dibutuhkan engine |
| P03 | Working agent loop dengan scripted model/fake MCP |
| P04 | Fresh PostgreSQL persistence, approval, ledger/recovery |
| P05 | Live-capable model/MCP adapters, resources/prompts |
| P06 | Engine API/events dan durable run driver |
| P07 | Context management, scoped memory, bounded autonomy |
| P08 | Engine evaluation, standalone setup dan release evidence |

P03 adalah offline runtime milestone; P05 adalah MCP execution milestone; P06 preview API;
P08 adalah kandidat engine release. Tidak ada desktop/migrasi/parity V4 gate.

## P00: foundation

- **P00-01 - Project skeleton.** Buat package/strict tsconfig, config parser dasar, build dan
  folder layer sesuai kebutuhan. Acceptance: compile tanpa provider live/DB connection atau
  import sibling; tidak menyalin credentials; dependencies dipin dengan lockfile.
- **P00-02 - Engineering gates.** Implement size/function/complexity/dependency/cycle/docs checks.
  Acceptance: fixtures valid lulus dan pelanggaran 300/180/60/10 ditolak; function checks AST;
  generated-output rules jelas; docs checker memeriksa active R2 task/checklist consistency.
- **P00-03 - Evaluation specification.** Dataset IDs/rubric, fake MCP tools/resources/prompts,
  provider fixture format dan baseline manifest. Acceptance: fixture validation dapat diulang
  tanpa credentials; V4/Hermes scores tetap not measured sampai report nyata.
- **P00-04 - CI foundation.** Wire actual typecheck/lint/architecture/docs dan test runner.
  Acceptance: workflow install/check/build tersedia dan steps lulus lokal tanpa secrets;
  hosted CI menunggu repository/push yang diotorisasi; tidak ada script pass palsu;
  required command contract sesuai engineering standards.

Validation: foundation build/checks dan meaningful gate fixtures. No live API needed.

## P01: contracts and fresh data design

- **P01-01 - Identity and messages.** Trusted actor/app/optional tenant, conversation/run/step/call
  IDs, Clock/ID ports, normalized message/content. Acceptance: client scope override ditolak;
  text/media/structured content dan tool-call/result pairing punya typed contract.
- **P01-02 - Model and MCP ports.** ModelGateway, McpGateway, connection/catalog, actions/outcomes,
  usage/budget/cancellation contracts. Acceptance: tools/resources/prompts dan unsupported features
  terwakili tanpa SDK imports; tidak ada legacy knowledge/skill/intent taxonomy.
- **P01-03 - State and database blueprint.** New-schema ADR, store ports, entities/indexes/constraints dan
  run/tool-call/approval transition tables. Acceptance: schema tidak bergantung DB V4; scope,
  stale revision, unknown outcome dan terminal-state rules punya tests/specification.
- **P01-04 - Engine API schemas.** OpenAPI/events/error/idempotency/cursor schemas dari API contract.
  Acceptance: request/response/event fixtures divalidasi; no desktop endpoints atau old-UI mappers;
  compatibility rules additive/versioned ditulis.

Read: database-design, mcp-first-design, api-contract. Validate contracts/state schemas.

## P02: selective utility reuse

- **P02-01 - Adoption manifest.** Pilih utility yang dibutuhkan P03-P05 dari inventory; catat source
  SHA-256/exports/license/destination. Acceptance: adopted/deferred/rejected jelas; legacy mapper
  categories tidak diadopsi; tidak wajib memindahkan semua 17 candidates.
- **P02-02 - Async components.** Extract delay/deadline/retry/batch yang dipakai, inject logger,
  AbortSignal dan Clock bila diperlukan. Acceptance: timers cleaned, timeout bukan cancellation,
  invalid concurrency teruji; write retry hanya menurut explicit execution policy.
- **P02-03 - Time token and result helpers.** Adopt current-time/token estimate/emptiness sesuai
  kebutuhan. Acceptance: timezone/now injectable, estimates approximate, empty read valid;
  large temporal parser tetap deferred kecuali use case membuktikan kebutuhan.
- **P02-04 - MCP errors and fingerprints.** Adopt structured error unpacking/trace yang cocok,
  implement canonical approval digest terpisah dari cache hash. Acceptance: isError/auth/unknown
  cases dan nested encoding teruji; short MD5 tidak menjadi approval integrity mechanism.

Validate characterization/unit tests, size/dependency checks, provenance records.

## P03: working single-agent loop

- **P03-01 - Context and fake components.** History/context assembler, scripted model, fake MCP,
  in-memory stores untuk tests. Acceptance: final-only/single-tool/two-tool-chain traces deterministic;
  tidak ada framework SDK, intent matching atau legacy registry dependencies.
- **P03-02 - Step execution loop.** Coordinator <=180 lines memanggil narrow handlers.
  Acceptance: validate -> fake MCP -> normalized result -> next model iteration; pairing preserved,
  multi-step completion dan partial failure memakai evidence; no domain regex routing.
- **P03-03 - Budgets and cancellation.** Step/model/tool/time/output limits dan repetition guard.
  Acceptance: runaway model berhenti, cancellation mencegah dispatch tambahan, retries dibatasi,
  tool output tidak dapat menaikkan budget/izin.
- **P03-04 - Input approval and outcomes.** Clarification dan approval proposal via typed actions,
  deterministic result checks dan bounded correction. Acceptance: missing value pause/resume,
  revised args invalidate proposal; simple tasks tidak wajib extra planner/verification LLM.

Validate offline runtime/state suite dan eval fixtures. In-memory is not production persistence.

## P04: fresh database and durable execution

- **P04-01 - New PostgreSQL repositories.** Implement fresh schema/migrations/repositories dari
  P01 blueprint. Acceptance: isolated fresh install, scope/index/constraint tests, no legacy DB
  reads/writes/FKs; configuration tidak menebak connection string V4.
- **P04-02 - Claims ledger and idempotency.** Atomic claims/leases/fencing, model/tool attempt
  records, dispatch intent/outcome, request dedup. Acceptance: concurrent workers/lease expiry/crash
  windows teruji; unknown remote write tidak diulang otomatis; no exactly-once claim.
- **P04-03 - Durable approval policy.** Immutable connection/tool-version/args/scope snapshots,
  expiry/revise/accept/reject/consume. Acceptance: duplicate/stale decisions, revoked access dan
  parameter amendments teruji; approval tidak berasal dari model/tool text.
- **P04-04 - Checkpoint resume and cancel.** Persist history/run/step/events consistently,
  recover after restart and record cancellation. Acceptance: completed calls tidak redispatch;
  late results tidak menghidupkan run terminal; snapshot/cursor consistency tests lulus.

Validate PostgreSQL integration/concurrency/failure tests in fresh isolated environment.

## P05: model and MCP integration

- **P05-01 - First model adapter.** Implement selected provider melalui gateway, normalized tools,
  content/usage/stream/error/cancellation mapping. Acceptance: recorded/fake transport contracts lulus;
  live smoke hanya dengan akses yang diotorisasi; secret tidak masuk trace.
- **P05-02 - MCP lifecycle and tools.** Initialize/discover/paginate/list-change, namespaced IDs,
  schema validation, Streamable HTTP dan stdio sesuai chosen connectors. Acceptance: disconnect
  invalidates catalog; original server/tool names terpetakan benar; subprocess cleanup diuji.
- **P05-03 - MCP resources prompts and access.** Resources list/read, prompts list/get, per-user
  auth/refresh/revoke melalui credential ports. Acceptance: tools-only server tetap valid;
  resources/prompts application-controlled; cross-user access ditolak saat discovery/dispatch.
- **P05-04 - End-to-end MCP execution.** Wire model -> validated/approved MCP calls -> results
  -> final. Acceptance: read chain + controlled approved write, content blocks/isError/auth/unknown
  outcome cases lulus; no custom knowledge/skill/intent registries.

Validate model/MCP contracts and isolated integration; document unsupported negotiated features.

## P06: engine API and durable driver

- **P06-01 - HTTP use cases.** Fastify handlers untuk conversations/runs/input/cancel/approval/MCP
  connections, auth mapping dan stable errors. Acceptance: schema/ownership/revision/idempotency
  tests lulus, start returns 202; tidak membangun UI atau legacy compatibility.
- **P06-02 - Event stream and reconnect.** Durable sequenced events, SSE replay, heartbeat,
  bounded buffers dan snapshot fallback. Acceptance: expired cursor 410; duplicates dedupable,
  delta loss repaired from final message; reconnect tidak membuat calls baru.
- **P06-03 - Durable run driver.** Execute queued/resumable work independent of HTTP lifetime,
  claim limits, shutdown/restart recovery. Acceptance: client closes without cancel; worker restart
  continues safely; database-backed driver cukup awal, Redis/queue service tidak wajib.
- **P06-04 - API integration examples.** Headless client examples dan end-to-end contracts untuk
  run/input/approval/read chain/write. Acceptance: fresh engine dapat digunakan tanpa Next.js,
  desktop SDK, V4 database atau gateway; usage/progress/outcomes observable.

Validate API/event/driver integration and engine smoke report. No desktop acceptance required.

## P07: context and measured autonomy

- **P07-01 - Context budgeting and compression.** Relevant history selection/summary checkpoints.
  Acceptance: unresolved work dan tool-call/result pairing tetap utuh, output bounded, regression
  cases lulus; vector database tidak dipersyaratkan.
- **P07-02 - Scoped recall and notes.** Conversation search dan optional durable notes dengan
  provenance/correction/deletion. Acceptance: no cross-user leak; answers generated by model tidak
  otomatis menjadi fakta; basic DB search lebih dahulu jika cukup.
- **P07-03 - Outcome learning and maintenance.** Verified outcome/feedback menjadi reviewable
  memory proposals; persistent maintenance jobs bila diperlukan. Acceptance: failed/unverified
  trajectory tidak dipromosikan sebagai fakta; no source self-rewrite atau mandatory skill DB.
- **P07-04 - Bounded planning extensions.** Optional plan/context playbook untuk tasks yang terbukti
  membutuhkannya; baseline simple loop tetap default. Acceptance: ablation quality/usage report,
  no legacy executable skill taxonomy; fitur tanpa manfaat terukur deferred/default off.

Validate context/recall ownership and ablations. No autonomous subagents or desktop work.

## P08: evaluation and engine release

- **P08-01 - Engine regression suite.** Pin actual model/tool/config manifests dan jalankan relevant
  task/recovery/access cases. Acceptance: raw evidence, exclusions, cold/warm usage/latency dan
  critical deterministic tests dilaporkan; V4 bukan wajib schema/feature-parity target.
- **P08-02 - V4 Hermes comparison.** Common subset dan capability coverage secara terpisah.
  Acceptance: reproducible comparison runner/report; unsupported/not measured tercatat jujur;
  klaim superiority hanya jika actual evidence memenuhi evaluation gates.
- **P08-03 - Standalone setup and operations.** Fresh DB bootstrap, engine config/examples,
  health/readiness, migrations/recovery/runbook. Acceptance: clean environment dapat menjalankan
  engine tanpa legacy install/data, desktop atau Redis wajib; secrets tidak masuk examples.
- **P08-04 - Release evidence and extension review.** Review correctness/maintainability/ops,
  API boundaries dan remaining risks. Acceptance: actual check results tercatat; future desktop
  cukup dependency/API design review, tidak perlu implementasi; deploy terpisah sesuai otorisasi.

Validate full available checks, isolated integration, offline eval and authorized comparisons.
Missing external benchmark access cannot be reported as a benchmark win or a measured result.

## Explicit future backlog

Desktop UI/SDK/companion/device pairing, local-only/offline distribution, hosted-local sync,
file/browser/terminal platform, scheduling products, multi-agent delegation, V4 data import,
old-UI gateway dan procedural skill ecosystem memerlukan scope/tasks tersendiri nanti.
Jangan membuat dormant implementations untuk backlog ini dalam engine foundation.
