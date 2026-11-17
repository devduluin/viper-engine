# P08-03 prep: pemeriksaan clean environment (Claude, 17 November 2026)

Ini persiapan paralel, bukan claim P08-03. Menurut DAG, P08-03 bergantung pada P08-02. Pemeriksaan ini
hanya mencatat temuan dan tidak mengubah kode engine, progress, atau checklist.

## Cara uji

- Salinan bersih engine (tanpa `node_modules`, `dist`, `artifacts`, `.env`) di direktori scratch.
- Node v22.16.0.
- Database PostgreSQL lokal yang baru dibuat dan masih kosong (`viper_fresh_check`).
- Tanpa API key.
- Semua database uji di-drop setelah selesai; tidak ada sisa `viper_it_*` / `viper_fresh*`.

## Hasil yang berjalan

| Langkah | Hasil |
| --- | --- |
| `npm ci --ignore-scripts --no-audit` | 169 paket, OK |
| `npm run check` | exit 0: typecheck/lint/architecture/docs PASS, unit 275, contract 152, `eval:validate` 9 scenario |
| `npm run db:migrate` pada DB kosong | applied 1–12, current 12 |
| `npm run db:migrate` diulang | applied [], current 12 (idempotent) |
| `context:report` | completed (offline, tanpa DB/key) |
| `example:headless` | completed, 3 model calls (scripted), 1 write |
| `example:recall` | completed |
| `example:learning` | completed. Migration 12 dan learning masih P07-03 GPT yang sedang berjalan. |
| `.env.example` | semua password/API key kosong; tidak ada secret di examples |

## Temuan untuk P08-03

| # | Temuan | Dampak | Saran |
| --- | --- | --- | --- |
| F1 | **Tidak ada proses standalone.** Tidak ada script `start`/`serve`/`worker`. `VIPER_HOST`/`VIPER_PORT`/`VIPER_LOG_LEVEL` hanya di-parse oleh `parseFoundationConfig`, dan tidak ada entrypoint yang memakainya untuk `listen`. Engine hanya bisa jalan bila host menulis komposisi sendiri (seperti `examples/headless.ts` / runner workin-live). | Acceptance P08-03 ("clean environment dapat menjalankan engine") belum terpenuhi untuk operator. | Tambahkan entrypoint CLI `viper serve` / `viper worker` (atau satu proses keduanya) yang membaca config env, migrasi opsional, dan signal handling (`entrypoints/worker/signals.ts` sudah ada). |
| F2 | **Tidak ada health/readiness.** Route publik hanya `/api/v1/*`. `docs/worker-host.md:66` menyebut health endpoint sebagai pekerjaan P08. | Orchestrator (Docker/K8s/PM2) tidak bisa membedakan siap, rusak, atau DB belum dimigrasi. | `GET /healthz` (proses hidup) dan `GET /readyz` (DB reachable dan schema = versi migrasi terbaru), plus status worker (`status()` sudah tersedia). |
| F3 | **Worker pada DB yang belum dimigrasi tetap "running".** Probe: worker dibuat dan di-start pada DB kosong. Dalam 2 detik muncul 7 failures dan 7 maintenanceFailures, phase `running`, event hanya `failure:execution_failure`, tanpa penyebab "schema belum dimigrasi". | Salah deploy (lupa `db:migrate`) terlihat sebagai error generik yang berulang terus. | Saat start, cek versi schema terhadap migrasi terbaru dan gagal cepat dengan pesan jelas. Ini juga bisa dipakai oleh `/readyz` (F2). |
| F4 | **`VIPER_TEST_DB_*` di `.env` lokal kosong**, sedangkan `test:integration`, `example:*`, dan runner workin-live mewajibkannya. | Setiap agen atau operator harus menyetel env manual. | Isi di `.env` lokal (keputusan user), dan jelaskan di runbook bahwa ini server Postgres untuk database `viper_it_*` sementara. |
| F5 | **Belum ada runbook operasi.** Langkahnya tersebar: README (setup/check), `migrate-cli`, `worker-host.md`, `durable-driver.md`. | Fresh setup harus merangkai sendiri. | Satu `docs/operations.md`: prasyarat, `.env`, migrate, start server/worker, health, shutdown/restart, recovery run macet (dead-letter `delivery_failures`), backup/retensi event. |

Catatan: yang sudah baik dan tidak perlu diulang di P08-03 adalah migrasi yang idempotent, examples tanpa key, DB uji
yang terisolasi dan di-drop setelah selesai, serta gate offline yang hijau dari salinan bersih.
