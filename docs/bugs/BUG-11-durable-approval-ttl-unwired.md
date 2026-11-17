# BUG-11: `approvalTtlMs` durable tidak terhubung dan tidak divalidasi

Ditemukan pada re-audit Claude (17 November 2026). Severity: **MEDIUM**. BUG-05 baru selesai sebagian.

## Masalah

Remediasi BUG-05 menambahkan `approvalTtlMs?` ke `DurableDriverDependencies` (`src/application/durable/types.ts:16`)
dan `session.deps.approvalTtlMs ?? 60000` di `tool-commands.ts:67`. Ada tiga kekurangan:

1. **Tidak bisa diset.** Tidak ada pemanggil yang mengisi field ini, baik `createViperEngine`, worker options, maupun
   bootstrap (`grep approvalTtl src` hanya menemukan definisi dan pemakaiannya). Jalur produksi tetap 60 detik.
2. **Tidak divalidasi.** Nilai `0`, negatif, `NaN`, atau `Infinity` langsung diterima. Approval lalu kedaluwarsa seketika
   atau `expiresAt` menjadi tidak valid. Bandingkan dengan jalur in-process `AgentRunSession.start`
   (`src/application/runs/session.ts:24`), yang sudah melempar `RangeError` bila nilainya bukan safe integer ≥ 1.
3. **Dua sumber nilai default.** Jalur in-process memakai `approvalTtlMs = 60_000` di `session.ts`, sedangkan jalur durable
   memakai literal `60000` di `tool-commands.ts`. Keduanya bisa bergeser.

## Rekomendasi

- Ekspos opsi ini di `createViperEngine` / worker options.
- Validasi dengan aturan yang sama seperti `session.ts:24`, satu kali saat konfigurasi.
- Pakai satu konstanta default bersama.
- Tambahkan test untuk nilai kustom dan nilai invalid.

## Status: FIXED (Claude, 17 November 2026)

- `src/application/runs/approval-ttl.ts` menyediakan `DEFAULT_APPROVAL_TTL_MS` (60000) dan `parseApprovalTtl`. Fungsi ini
  hanya menerima safe integer ≥ 1 dan dipakai oleh jalur in-process (`session.ts`) maupun durable (`tool-commands.ts`).
- `DurableRunDriver` memvalidasi `approvalTtlMs` saat dibangun. Nilai invalid langsung gagal dengan
  `RangeError('Invalid approval TTL')`.
- Opsi publik baru `ViperEngineOptions.approvalTtlMs` (`createViperEngine` / `createEngineWorker`) diteruskan ke driver.
- Test:
  - unit `tests/unit/runs-approval-ttl.test.ts`;
  - integration `durable-driver.test.ts`, yang memastikan TTL kustom tersimpan di `expiresAt` dan nilai invalid ditolak.
