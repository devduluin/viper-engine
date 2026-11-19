# Mulai dari sini: Viper Engine

Revision R2.1,18 November2026. P00-P08 DONE (36/36).
Workspace check lulus (486 unit/contract tests); PostgreSQL integration185/185 dan60/60 engine trials PASS.
OpenAI extension reviewed; live OpenAI belum menjadi bukti verifikasi rilis ini.
HTTP/worker/SSE, context/recall/proposals, optional checklist dan regression/comparison runner tersedia.
P08-04 audit/release review selesai: READY_FOR_CONTROLLED_PILOT; actual V4/Hermes comparison INCONCLUSIVE.
Extension terbaru: [local tool discovery](docs/tool-discovery.md), env auto/on/off dan batas katalog
model; [handoff](docs/handoffs/TOOL-DISCOVERY.md) mencatat validasi aktual setelah snapshot P08-04.
Distribusi ke host: [packaging/env](docs/packaging.md), [handoff](docs/handoffs/PACKAGING.md).

## Keputusan pemilik

Engine baru MCP-first dengan DB baru, mengadopsi prinsip agent loop Hermes. Tidak mewariskan
kategori tools/knowledges/skill, intent pipeline atau schema V4. Tools berarti callable MCP.
Utility lama boleh direuse selektif. Desktop masih rencana, bukan development/release dependency.
Kode reusable wajib mengikuti limits source 300/runtime 180/function 60/complexity 10.

## Urutan baca

1. [AGENTS](AGENTS.md): aturan kerja wajib.
2. [Progress](docs/progress.md): status aktual dan validation evidence.
3. [Parallel development](docs/parallel-development.md): lane, dependency dan file ownership.
4. [Architecture](docs/architecture.md) dan task terkait di [development plan](docs/development-plan.md).
5. [Engineering standards](docs/engineering-standards.md) dan [tooling](docs/tooling.md).

Tidak perlu membaca seluruh proyek lama. Pilih referensi sesuai task:

| Topic | Dokumen |
| --- | --- |
| Identity/state/database | [Database design](docs/database-design.md) |
| Model/MCP ports dan execution | [MCP design](docs/mcp-first-design.md) |
| API/events | [API contract](docs/api-contract.md) |
| Utility adoption | [Reuse inventory](docs/reuse-inventory.md) |
| Evaluation data | [Evaluation plan](docs/evaluation-plan.md), [fixture rubric](evals/rubric.md) |
| Reporting | [Handoff](docs/agent-handoff.md), [checklist](docs/development-checklist.md) |

## Development environment

Node 22.16.x, pinned dependencies via `npm ci --ignore-scripts --no-audit`.
`npm run check` dan `npm run build` adalah baseline gates. PowerShell bisa menggunakan npm.cmd.
PostgreSQL integration mempunyai command terpisah; ikuti handoff P04-01 dan gunakan DB isolated.
Comparison runner tersedia; real-model dan capture V4/Hermes belum diukur. Unit/contract checks tidak mengakses live provider.

## Status dan prioritas berikut

- **P01-02 dan P02-04 DONE**: baca [model/MCP handoff](docs/handoffs/P01-02.md)
  dan [normalization/fingerprint handoff](docs/handoffs/P02-04.md) untuk stable module APIs.
- **P01-03 DONE**: [state/schema handoff](docs/handoffs/P01-03.md) telah direview.
- **P01-04 DONE**: [API guide](docs/api/README.md) dan [handoff](docs/handoffs/P01-04.md)
  memuat 41 schema, 12 operasi, event/error/idempotency/cursor semantics untuk P06.
- **P02 DONE**: async/time/token/result helpers sudah direview; token overflow diperbaiki dan
  [review](docs/reviews/P02-03.md) resolved. Provenance tetap ada pada handoffs.
- **P03-01 DONE**: [context/offline handoff](docs/handoffs/P03-01.md) menjelaskan stable APIs,
  fake components, 19 tes baru dan batas implementasi.
- **P03-02 DONE**: [runtime handoff](docs/handoffs/P03-02.md) selesai direview, termasuk scope/catalog fix.
- **P03-03 DONE**: [budget/cancellation handoff](docs/handoffs/P03-03.md) wajib dibaca sebelum
  mengubah runtime. Mencakup timer, output, repetition, dispatchState dan batas per-invocation.
- **P03-04 DONE**: [workflow handoff](docs/handoffs/P03-04.md) menjelaskan scoped in-memory
  session, exact approval/revise, input dedup, retained counters dan batas durable integration.
- **P04-01 DONE**: [persistence handoff](docs/handoffs/P04-01.md) dan
  [review](docs/reviews/P04-01.md): tiga temuan diperbaiki Claude dan diverifikasi independen.
- **P04-02 DONE**: [review](docs/reviews/P04-02.md) wajib dibaca: lease tidak opsional setelah
  claim, release(at), idempotency claimId, database clock dan control-plane wake yang terpisah.
- **P04-03 DONE**: [review](docs/reviews/P04-03.md) dan [handoff](docs/handoffs/P04-03.md)
  mencakup immutable approval, access/expiry/revise; belum menyambungkan session ke durable driver.
- **P05-01/P05-02 DONE**: baca [model review](docs/reviews/P05-01.md) dan
  [MCP review](docs/reviews/P05-02.md) untuk fixed boundaries dan limitation.
- **P05-03 DONE**: [review](docs/reviews/P05-03.md) mencakup pending/live session revocation,
  resource/prompt admission dan credential refresh tanpa replay tool yang gagal.
- **P05-01b DONE**: [review OpenAI](docs/reviews/P05-01b.md); extension P05-01, tidak menambah DAG.
- **P04-04 DONE**: [handoff](docs/handoffs/P04-04.md), [review](docs/reviews/P04-04.md) dan
  [driver guide](docs/durable-driver.md) wajib dibaca untuk journal atomik dan recovery boundaries.
- **P05-04 DONE**: [composition guide](docs/engine-composition.md), [handoff](docs/handoffs/P05-04.md)
  dan [review](docs/reviews/P05-04.md). Factory merangkai actual SDK/MCP/validator/policy/driver;
  approved write, read chain, content/auth/unknown dan shutdown/recovery teruji.
- **P06-01 DONE**: [HTTP guide](docs/http-api.md), [handoff](docs/handoffs/P06-01.md) dan
  [review](docs/reviews/P06-01.md). 11 authenticated non-streaming operations, atomic commands,
  owner/revision/dedup, signed cursors dan private context; migration 0008 pada DB isolated.
- **P06-03 DONE**: [worker guide](docs/worker-host.md), [handoff](docs/handoffs/P06-03.md) dan
  [review](docs/reviews/P06-03.md): bounded polling/concurrency, durable cooldown, expiry/wake,
  cancellation tanpa discovery, signal/shutdown dan OS-kill recovery.
- **P06-02 DONE**: [stream guide](docs/event-stream.md), [handoff](docs/handoffs/P06-02.md) dan
  [review](docs/reviews/P06-02.md). Public projection, cursor/retention/replay, heartbeat/auth,
  bounded backpressure dan actionable approval/input teruji. Current full stack requires migration 0010.
- **P06-04 DONE**: [headless guide](docs/headless-client.md), [handoff](docs/handoffs/P06-04.md) dan
  [review](docs/reviews/P06-04.md): client/reconnect, examples, usage dan outcome teruji.
- **P07-01 DONE**: [context guide](docs/context-budgeting.md), [handoff](docs/handoffs/P07-01.md) dan
  [review](docs/reviews/P07-01.md): bounded view, immutable history/approval, verified checkpoints dan restart.
- **P07-02 DONE**: [recall guide](docs/scoped-recall.md), [handoff](docs/handoffs/P07-02.md) dan
  [review](docs/reviews/P07-02.md): owned search, explicit user notes, CAS/audit/delete dan fresh evidence.
  Recall membutuhkan migration0011; learning membutuhkan migration0012 (21 engine tables plus ledger).
- **P07-03 DONE**: [guide](docs/outcome-proposals.md), [handoff](docs/handoffs/P07-03.md) dan
  [review](docs/reviews/P07-03.md): verified outcome/feedback, exact review, atomic note/audit/retirement.
- **P07-04 DONE**: [guide](docs/bounded-planning.md), [handoff](docs/handoffs/P07-04.md),
  [ablation](docs/reports/P07-04-ablation.md): scoped advisory checklist opt-in/default off;
  automatic planning deferred, live semantic benefit unmeasured. No additional runtime authority.
- **P08-01 DONE**: [guide](docs/engine-regression.md), [handoff](docs/handoffs/P08-01.md),
  [report](docs/reports/P08-01-regression.md): pinned manifests/raw TAP,60 local cold/warm trials;
  usage explicitly scripted/unavailable, semantic/provider billing/comparison unmeasured.
- **P08-02 DONE (runner/report)**: [guide](docs/engine-comparison.md), [handoff](docs/handoffs/P08-02.md),
  [report](docs/reports/P08-02-comparison.md): common subset vs coverage, verified inputs dan explicit exclusions.
  Actual comparison INCONCLUSIVE; V4/Hermes NOT_MEASURED, superiority NOT_ESTABLISHED.
- **Cache extensions Claude**: [plan](docs/engine-extensions-plan.md), migration0013,21 engine tables plus ledger.
  Combined tree validated; comparison tidak menambah migration atau runtime/API behavior.
- **P08-03 DONE**: [setup](docs/standalone-operations.md), [runbook](docs/operations-runbook.md),
  [handoff](docs/handoffs/P08-03.md), [report](docs/reports/P08-03-operations.md): clean install/build/DB,
  packaged SQL, schema-before-polling, authenticated health/readiness dan shutdown/recovery teruji.
- **P08-04 DONE**: [release review](docs/release-review.md), [findings](docs/reviews/P08-04.md),
  [handoff](docs/handoffs/P08-04.md), [evidence](docs/reports/P08-04-release.md). Lima bug kode diperbaiki,
  dependency patched/pinned dan audit registry0 advisory; clean install/build/DB teruji.
  Tidak ada task R2.1 tersisa. Live quality/comparison, load/restore dan deployment perlu scope berikutnya.
- **Workin user-declined fix DONE**: [handoff](docs/handoffs/WORKIN-REJECTION.md), [review](docs/reviews/WORKIN-LIVE.md).
  [MCP session/resource fix DONE](docs/handoffs/WORKIN-MCP-SESSION.md); host diagnostics dan live rerun masih pending.

Baca [P01-01 handoff](docs/handoffs/P01-01.md) untuk frozen identity/messages API dan
[P02-01 manifest](docs/reuse/P02-01.md) untuk exact source/provenance/adaptation requirements.
Shared helpers menerima primitive instants/functions dari composition; tidak mengimpor contracts.

Task [DAG](docs/task-dependencies.json) adalah acuan. Lanes di parallel guide memiliki
path ownership terpisah. Integration owner mengelola package/config/root exports/status dan gates.
Workers hanya menulis path miliknya serta task-specific handoff; jangan ubah shared checklist.

## Prompt untuk agen berikutnya

```text
Bekerja di D:\Development\App\viper-engine hanya pada follow-up yang dipilih pengguna.
Baca START_HERE.md, AGENTS.md, release review dan handoff/report P08-04.
Roadmap R2.1 sudah36/36 DONE; jangan mengulang foundation atau menganggap scope baru otomatis disetujui.
Gunakan daftar remaining evidence untuk live pilot/load/restore bila sesuai assignment; desktop tetap deferred.
Pertahankan complete tool exchanges, approval binding, immutable history dan budget lintas resume.
Pertahankan baseline loop dan default-off planning; jangan membuat authority atau legacy taxonomy baru.
Gunakan DB isolated dan fixture SDK/MCP tanpa live key atau database aplikasi.
Pertahankan cache support, schema-version pin, DB-time leases, proposal fencing dan startup guards.
Catat finding/perbaikan/validation/limitations; integration owner memperbarui checklist/progress.
```

Live integration tasks memerlukan keputusan provider/access sendiri; jangan menganggap
dependency-ready berarti akses eksternal atau credential sudah tersedia.
