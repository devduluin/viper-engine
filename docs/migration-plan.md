# Independent build and selective reuse

Revision R2. Nama file dipertahankan untuk tautan; proyek ini tidak mensyaratkan migrasi V4.
Source of truth task aktif: [development plan](development-plan.md) dan [checklist](development-checklist.md).

## Database dan model baru

Bangun database/schema `viper_engine` baru melalui persistence adapter. Tidak menyalin
migration files, entity taxonomy, IDs, foreign keys atau records V4. Tidak perlu gateway atau
UI compatibility untuk menyelesaikan engine. [Database design](database-design.md) menjadi acuan.

V4 merupakan referensi perilaku/use cases dan sumber utility, bukan domain model target.
Tidak ada kewajiban mempertahankan semua fitur V4 atau mengimplementasikan tools/knowledges/skill
categories. MCP tools/resources/prompts memakai standard protocol semantics.

## Reuse yang diizinkan

Utility copy/adapt diperbolehkan bila behavior sesuai dan size constraints terpenuhi.
Catat source SHA-256, symbols, license/ownership, destination, changes dan characterization tests.
Tidak ada runtime imports, symlink atau TS path alias ke sibling source.
Legacy planner, registry, response footer/parameter/category mappers tidak menjadi fondasi baru.

Source snapshots pada [reuse inventory](reuse-inventory.md) bukan perintah menyalin semua files.
Selected helpers dipakai ketika task memerlukannya. Tidak menyalin `.env`, tokens, logs, database
connection settings atau dependencies bundling dari proyek lama.

## Rollout engine

Run engine di environment/DB sendiri; gunakan fake MCP dan isolated real connectors sesuai
kebutuhan tests. Regression/comparison memakai fixtures atau controlled environments, bukan
menjalankan dua engine untuk satu aksi tulis produksi.

Fresh setup, health/readiness, recovery, deployment config dan rollback versi engine sendiri
menjadi P08. Deployment produksi tetap tindakan terpisah sesuai otorisasi.
Unknown remote outcome direkonsiliasi sebelum retry/fallback; timeout bukan bukti tidak ada effect.

## Jika integrasi V4 diminta nanti

Tambahkan scope tersendiri untuk API adapters, data import, identity mapping, backup/dry-run,
reconciliation dan cutover. Pending approvals lama tidak dipindahkan sebagai izin eksekusi baru.
Tidak perlu mendesain atau membangun adapters/importer tersebut pada phase engine sekarang.

Desktop dan multi-agent juga berada pada backlog terpisah. Tidak menjadi dependency release
atau alasan membuat schema/components placeholder sekarang.
