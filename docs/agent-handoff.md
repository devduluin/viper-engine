# Agent handoff protocol R2.1

Mulai dari [START_HERE](../START_HERE.md); aturan wajib ada di [AGENTS](../AGENTS.md).
Tidak meminta spawn subagents. Kerjakan scope pengguna, bukan seluruh roadmap sekaligus.

## Before implementation

1. Baca progress, architecture, task acceptance dan engineering standards.
2. Baca MCP/database/API/reuse docs hanya yang relevan pada task.
3. Periksa actual files agar tidak menimpa perubahan pengguna/agen lain.
4. Pilih task NOT STARTED dengan dependency DONE, catat ownership/next step.
5. Gunakan plan R2.1, 36 tasks dengan task-level DAG dan parallel path ownership.

P00-P08 DONE (36/36); controlled-pilot [release review](release-review.md) dan [audit](reviews/P08-04.md) tersedia.
V4/Hermes captures NOT_MEASURED; comparison INCONCLUSIVE. Tidak ada next R2.1 DAG task.
Ambil follow-up hanya sesuai assignment pengguna, baca [handoff P08-04](handoffs/P08-04.md), lalu klaim scope di progress.
Workers menulis docs/handoffs/<task>.md; integration owner mengubah shared checklist/progress.

## Scope reminders

New DB/schema, model/MCP loop, no legacy tools/knowledges/skill categories or intent pipeline.
Reuse pure utilities as needed; no old source runtime imports, no env/credential copy.
Desktop/UI/device companion/delegation/legacy migration bukan task aktif.
Ports dan versioned APIs cukup untuk future extensibility; jangan buat placeholder subsystems.

## Implementation rules

Source <=300/loop <=180/function <=60/complexity <=10; components memiliki satu responsibility.
Write behavior tests pada boundaries yang penting: transitions, scope, dispatch, resume, approval,
unknown outcomes. Fake model/MCP untuk offline tests; live API mengikuti keputusan akses user
serta instruksi session/provider yang berlaku. Dokumentasi tidak memberi izin secret provisioning.

## Status and evidence

Status: NOT STARTED, IN PROGRESS, BLOCKED, DONE. BLOCKED doc task bukan pengganti aturan
application goal status. Checklist [x] hanya jika acceptance dan required actual validation lulus.
File creation atau report not measured tidak otomatis berarti fitur/benchmark complete.

Tambahkan entry ke progress:

```text
Task ID/title + spec revision R2.1:
Status and agent/session/timestamp:
Scope/dependencies:
Behavior delivered and files changed:
Reuse source hashes/adaptation/provenance:
Contracts/schema changes:
Commands run and actual results:
Checks not run and why:
Acceptance met / remaining:
Risks/limitations:
Exact next eligible task or next failing case/command:
```

Jangan memasukkan private payloads/credentials di logs. Jangan menyatakan semua checks lulus
jika belum dijalankan. P00 tooling tersedia; local doc checks tidak membuktikan
runtime correctness. Bila context habis, simpan coherent work dan precise handoff, bukan fake pass.

## Definition of done

Task acceptance terpenuhi, required checks available lulus, source limits/boundaries terpenuhi,
contracts/provenance/negative cases relevan diuji, checklist/progress sinkron, limitations jelas.
No unrelated rewrite atau perubahan proyek lama. Deploy produksi terpisah sesuai otorisasi.

## Prompt template

```text
Kerjakan P01-01 di D:\Development\App\viper-engine.
Baca START_HERE.md dan AGENTS.md; ikuti plan R2.1 dan parallel lane ownership.
Fokus engine MCP-first dan database baru. Jangan implementasikan desktop atau kategori V4.
Selesaikan task sesuai acceptance, jalankan validasi relevan dan tulis task-specific handoff.
```

Template bukan instruksi mulai development pada turn dokumentasi ini.
