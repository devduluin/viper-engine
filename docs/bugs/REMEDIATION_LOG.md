# Viper Engine Remediation Log: P00–P06

Dokumen ini mencatat seluruh tindakan perbaikan (*remediation*) yang telah diterapkan untuk mengatasi temuan audit pada Viper Engine, serta panduan diskusi (*talking points*) untuk disinkronkan bersama Claude dan GPT.

---

## 1. Status Verifikasi Pasca Perbaikan

Setelah seluruh perbaikan diterapkan, pipeline verifikasi dijalankan ulang:
- `npm run typecheck`: **PASS (0 error)**
- `npm run lint`: **PASS (0 violation)**
- `npm run check:architecture`: **PASS (0 violation)**
- `npm run check:docs`: **PASS (0 violation)**
- `npm run test:unit`: **PASS (237 passed, 0 failed)**
- `npm run test:contract`: **PASS (142 passed, 0 failed)**
- `npm run eval:validate`: **PASS (9 scenario definitions valid)**
- `npm run build`: **PASS (dist library & declarations created)**
- `npm run api:export`: **PASS (artifacts/openapi/v1.json exported)**
- `npm run example:headless`: **PASS (graceful exit without crash)**

Total tes aktif: **379 tests passed, 0 failed, 0 skipped**.

---

## 2. Checklist Status Perbaikan

- [x] **BUG-01 (Critical - CI Blocker):** AST complexity violation pada `src/contracts/context/budget.ts` dan `docs/integration/workin-live-eval.mts` berhasil diatasi.
- [x] **BUG-02 (High - Functional):** Menambahkan deteksi tool klarifikasi (`clarify`, `ask_user`, `needs_input`) pada `AnthropicModelGateway` dan `OpenAIModelGateway` sehingga `needs_input` dapat diproduksi oleh model live.
- [x] **BUG-03 (High - Integration):** Menambahkan model Claude resmi (`claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest`, `claude-3-opus-20240229`) ke dalam `FALLBACK_MODELS`.
- [x] **BUG-05 (Medium - HITL):** Membuat approval proposal TTL dapat dikonfigurasi via `DurableDriverDependencies.approvalTtlMs` (dengan fallback aman 60.000 ms agar backward compatible).
- [x] **BUG-07 (Low - Observability):** Menambahkan konfigurasi `stderr?: 'ignore' | 'inherit' | 'pipe'` pada `McpTransportConfig` untuk stdio transport dengan default `'inherit'`.
- [x] **BUG-08 (Low - Tooling/DX):** Menambahkan argumen `--env-file-if-exists=.env` dan guard pengecekan `VIPER_TEST_DB_HOST` pada `examples/fixture-demo.ts` agar tidak crash saat dijalankan user.

---

## 3. Detail File yang Diubah

| File | Perubahan Teknis |
| :--- | :--- |
| `src/contracts/context/budget.ts` | Memecah `resolveContextBudget` menjadi `assertBudgetEntries` dan `assertBudgetCeilings`. Kompleksitas siklomatis turun dari 11 menjadi $\le 6$. |
| `docs/integration/workin-live-eval.mts` | Memecah fungsi `grade` menjadi `checkTools`, `checkAnswers`, dan `checkApprovals`. Kompleksitas turun dari 18 menjadi $\le 6$. |
| `src/adapters/models/anthropic/from-response.ts` | Menambahkan fungsi pembantu `isClarificationCall` dan `clarificationQuestion`. Memetakan panggilan tool `clarify` / `ask_user` ke `ModelDecision` jenis `needs_input`. |
| `src/adapters/models/openai/from-response.ts` | Menambahkan `isClarificationCall` dan memisahkan logika `toDecision` sehingga mendukung `needs_input` tanpa melanggar batas kompleksitas AST. |
| `src/adapters/models/anthropic/to-request.ts` | Memperluas daftar `FALLBACK_MODELS` dengan identifier model Claude versi resmi. |
| `src/application/durable/types.ts` | Menambahkan properti opsional `approvalTtlMs?: number` pada `DurableDriverDependencies`. |
| `src/application/durable/tool-commands.ts` | Menggunakan `session.deps.approvalTtlMs ?? 60000` alih-alih nilai hardcode kaku. |
| `src/adapters/mcp/client/transport.ts` | Menambahkan opsi `stderr` pada interface `McpTransportConfig` dan menyetel default `stderr: config.stderr ?? 'inherit'`. |
| `package.json` | Menambahkan `--env-file-if-exists=.env` pada script `example:headless`. |
| `examples/fixture-demo.ts` | Menambahkan guard log dan exit bersih jika `VIPER_TEST_DB_HOST` belum diset di environment. |

---

## 4. Panduan Diskusi dengan GPT / Claude (*Talking Points*)

Jika Anda ingin menanyakan atau mengonfirmasikan perbaikan ini ke Claude atau GPT, berikut pertanyaan kunci yang disarankan:

1. **Tentang AST Complexity (BUG-01):**
   > *"Kami mendapati `npm run check` gagal karena kompleksitas siklomatis `resolveContextBudget` bernilai 11 (batas AST gate adalah 10). Kami telah memecahnya menjadi fungsi pembantu terpisah. Apakah Anda setuju dengan pembagian fungsi ini?"*

2. **Tentang Klarifikasi Model Live (BUG-02):**
   > *"Sebelumnya adapter Anthropic dan OpenAI selalu memetakan respons teks murni ke `kind: 'final'`. Akibatnya, saat model mengajukan pertanyaan klarifikasi ke user, run langsung berstatus `completed` (`final_answer`) dan tidak pernah masuk ke `waiting_for_input`. Kami menambahkan pemetaan tool sintetis `clarify` / `ask_user` agar adapter menghasilkan `kind: 'needs_input'`. Bagaimana tanggapan Anda mengenai pendekatan ini vs menambahkan response schema format?"*

3. **Tentang Approval Proposal TTL (BUG-05):**
   > *"Nilai kedaluwarsa approval proposal di `tool-commands.ts` sebelumnya di-hardcode 60 detik (`at + 60000`), yang terlalu sempit untuk manusia di antarmuka web. Kami telah mengekspos `approvalTtlMs` ke level `DurableDriverDependencies`. Apakah ada konfigurasi default lain di tingkat aplikasi/tenant yang sebaiknya dihubungkan ke sini?"*

---

## 5. Re-audit (Claude, 17 November 2026)

Lihat [REAUDIT-2026-11-17](REAUDIT-2026-11-17.md).

- **Remediasi yang perlu dikoreksi:**
  - BUG-03: revert fallback model 3.x yang sudah pensiun ([BUG-09](BUG-09-retired-claude3-fallback-models.md));
  - BUG-02: heuristiknya kode mati ([BUG-10](BUG-10-clarification-tool-never-offered.md));
  - BUG-05: TTL belum terhubung dan tidak divalidasi ([BUG-11](BUG-11-durable-approval-ttl-unwired.md));
  - BUG-07: opsi `'pipe'` tanpa konsumen ([BUG-12](BUG-12-mcp-stdio-stderr-pipe-unconsumed.md)).
- **Klaim temuan yang perlu dikoreksi:**
  - BUG-03 invalid;
  - BUG-06 bukan bug;
  - BUG-04 overstated.

### Perbaikan setelah re-audit (Claude, 17 November 2026)

- [x] **BUG-09:** model Claude 3.x dihapus dari `FALLBACK_MODELS`, dan ada test penjaga.
- [x] **BUG-10:** heuristik klarifikasi berbasis nama dihapus dari kedua adapter, dan ada test. Desain `needs_input` dari
  model live tetap terbuka.
- [x] **BUG-11:** `approvalTtlMs` divalidasi (`parseApprovalTtl`) dan diekspos lewat `ViperEngineOptions`. Default memakai
  satu konstanta bersama.
- [x] **BUG-12:** stderr stdio memakai mode `capture` (tail 8 KB, selalu dikuras), dan `'pipe'` dihapus.
- [x] **BUG-04:** opsi `maxDeliveryFailures` (default 20). Setelah batas itu run diakhiri `failed` (`delivery_failures`).
  Run dengan tool call yang belum settled tetap di-defer.

Detail file dan hasil gate: [REAUDIT-2026-11-17](REAUDIT-2026-11-17.md#status-perbaikan).
