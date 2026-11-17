# BUG-05: Hardcoded 60-Detik Expiration pada Human-In-The-Loop Approval

## 1. Ringkasan Masalah

Pada modul `src/application/durable/tool-commands.ts` (baris 94):
```typescript
commands.push({
  kind: 'approval_proposal',
  input: {
    id,
    at,
    expiresAt: at + 60000, // <--- Hardcoded 60 detik (1 menit)
    binding: { runId: row.runId, toolCallId: row.id, tool: row.tool, argumentsDigest: row.argumentsDigest },
    arguments: call.arguments,
    ...
  }
});
```

Batas waktu persetujuan manusia (*approval proposal expiration*) di-hardcode tepat **60.000 milidetik (60 detik / 1 menit)**.

## 2. Analisis Kasus & Dampak

Human-in-the-Loop (HITL) adalah salah satu fitur inti Viper Engine untuk menjaga keamanan pemanggilan aksi sensitif (seperti eksekusi penulisan data, modifikasi database, atau pengiriman uang).

Dalam skenario dunia nyata:
- Pengguna atau administrator menerima notifikasi persetujuan melalui dashboard web, aplikasi seluler, pesan Slack, atau email.
- Hampir mustahil bagi manusia untuk membaca konteks aksi, meninjau parameter, dan menekan tombol "Approve" dalam rentang waktu di bawah 60 detik.
- Begitu waktu 60 detik lewat, `approvalDecision` di baris 30:
  ```typescript
  if (approval !== undefined && approval.expiresAt <= session.deps.clock.now()) return 'reject';
  ```
  langsung menganggap approval **hangus (*expired*)** dan menolak panggilan tool tersebut dengan `approval_expired`.

Run tersebut kemudian gagal atau berhenti tanpa sempat dieksekusi secara sah oleh pengguna.

## 3. Solusi & Rekomendasi

1. Hapus nilai *magic number* `60000` dari `tool-commands.ts`.
2. Masukkan parameter konfigurasi TTL approval pada level engine/worker config:
   ```typescript
   export interface ApprovalPolicyOptions {
     readonly defaultTtlMs?: number; // Contoh default: 86400000 (24 jam) atau 3600000 (1 jam)
   }
   ```
3. Izinkan model/tool definition atau policy runtime menentukan batas TTL yang sesuai dengan tingkat kekritisan aksi.

## Re-audit (Claude, 17 November 2026)

Remediasi awal belum terhubung dan belum divalidasi. Sudah diselesaikan lewat
[BUG-11](BUG-11-durable-approval-ttl-unwired.md) (opsi `approvalTtlMs` di engine, dengan validasi).
