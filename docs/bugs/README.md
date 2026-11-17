# Viper Engine Audit Report: P00 to P06

Dokumen ini berisi rekapitulasi audit profesional terhadap fondasi Viper Engine (fase P00 hingga P06) yang telah diselesaikan oleh tim agen sebelumnya (GPT & Claude).

## 1. Executive Summary

- **Total Area yang Diaudit:** 7 Fase (P00 Skeleton/Gates, P01 Contracts/State, P02 Shared Utilities, P03 Runtime Loop, P04 Persistence/Postgres, P05 Adapters Models & MCP, P06 Engine API & Worker Driver).
- **Status Build & Gates:** **PASS** (379 tests pass, 0 violations pada lint, architecture, docs, dan build).
- **Total Temuan Bug & Defect:** 8 Temuan Utama (1 Blocker, 3 High, 2 Medium, 2 Low).
- **Log Perbaikan:** Seluruh tindakan perbaikan dan panduan diskusi dengan GPT/Claude dicatat di [REMEDIATION_LOG](REMEDIATION_LOG.md).

## 2. Tabel Ringkasan Temuan (Bugs & Defects)

| ID | Kategori | Severity | Komponen Terdampak | Ringkasan Masalah |
| :--- | :--- | :--- | :--- | :--- |
| [BUG-01](BUG-01-ast-complexity-violation.md) | Quality / Gate | **CRITICAL** | `src/contracts/context/budget.ts` | AST complexity 11 (melebihi batas 10) menggagalkan `npm run check`. |
| [BUG-02](BUG-02-needs-input-missing-in-live-gateways.md) | Architecture / Logic | **HIGH** | `src/adapters/models/{anthropic,openai}` | Model gateway live tidak pernah menghasilkan `needs_input`; run langsung dianggap `completed`. |
| [BUG-03](BUG-03-anthropic-hallucinated-specs.md) | Integration / Provider | **HIGH** | `src/adapters/models/anthropic/` | Model fiktif (`claude-opus-5-5`), beta palsu, dan sintaks adaptive thinking tidak valid pada Anthropic SDK. |
| [BUG-04](BUG-04-worker-poison-pill-infinite-loop.md) | Reliability / Recovery | **HIGH** | `src/application/durable/driver.ts` | Run gagal diulang tanpa batas (poison pill spin-loop), tidak ada batas max retries/dead-letter. |
| [BUG-05](BUG-05-hardcoded-approval-expiration.md) | Workflow / HITL | **MEDIUM** | `src/application/durable/tool-commands.ts` | Timeout persetujuan manusia di-hardcode 60 detik (`expiresAt: at + 60000`), tidak realistis untuk produksi. |
| [BUG-06](BUG-06-dispatch-state-cancellation-drift.md) | State Integrity | **MEDIUM** | `src/agent/execution/dispatch.ts` | State drift: Event `dispatching` telah terbit namun laporan tool mencatat `dispatchState: 'not_sent'`. |
| [BUG-07](BUG-07-mcp-stdio-stderr-dropped.md) | Observability | **LOW** | `src/adapters/mcp/client/transport.ts` | `stderr: 'ignore'` menghilangkan pesan error fatal saat server MCP subprocess crash. |
| [BUG-08](BUG-08-example-test-db-dependency.md) | Tooling / DX | **LOW** | `examples/fixture-demo.ts` | Script contoh crash karena coupling ke konfigurasi database integration test internal. |
| [BUG-09](BUG-09-retired-claude3-fallback-models.md) | Integration / Provider | **HIGH** | `src/adapters/models/anthropic/to-request.ts` | Remediasi BUG-03 menambahkan model Claude 3.x yang sudah pensiun ke fallback; perlu di-revert. |
| [BUG-10](BUG-10-clarification-tool-never-offered.md) | Architecture / Logic | **MEDIUM** | `src/adapters/models/{anthropic,openai}/from-response.ts` | Heuristik `clarify`/`ask_user` tidak pernah tereksekusi (tool tidak ditawarkan), berisiko bentrok nama, tanpa test. |
| [BUG-11](BUG-11-durable-approval-ttl-unwired.md) | Workflow / HITL | **MEDIUM** | `src/application/durable/` | `approvalTtlMs` durable tidak bisa diset dari API publik dan tidak divalidasi. |
| [BUG-12](BUG-12-mcp-stdio-stderr-pipe-unconsumed.md) | Reliability | **LOW** | `src/adapters/mcp/client/transport.ts` | Opsi `stderr: 'pipe'` tanpa konsumen bisa membuat child process block. |

## Re-audit

[REAUDIT-2026-11-17](REAUDIT-2026-11-17.md) (Claude) menyimpulkan:

- **Status temuan awal:**
  - BUG-03 **invalid**;
  - BUG-06 **bukan bug**;
  - BUG-04 **overstated**, karena backoff dan deadline sudah ada;
  - BUG-02, BUG-05 dan BUG-07 baru diperbaiki sebagian.
- **Temuan baru:** BUG-09 sampai BUG-12.

Setelah itu Claude memperbaiki BUG-04 (dead-letter), BUG-09, BUG-10, BUG-11 dan BUG-12. Desain `needs_input` dari model live
(BUG-02) tetap terbuka.

## 3. Matriks Dampak & Rekomendasi Prioritas

1. **Immediate Remediation (P0):** Perbaiki BUG-01 agar CI dan command `npm run check` hijau kembali.
2. **Provider & Functional Alignment (P1):** Perbaiki BUG-02 dan BUG-03 agar live model (Claude & OpenAI) dapat digunakan di dunia nyata dan alur klarifikasi `needs_input` berjalan sesuai spesifikasi.
3. **Resilience & Production Readiness (P2):** Terapkan limit retry/dead-letter (BUG-04) dan buat approval TTL dapat dikonfigurasi (BUG-05).
