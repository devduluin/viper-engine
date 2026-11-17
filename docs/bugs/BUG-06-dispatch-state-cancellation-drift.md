# BUG-06: Inkonsistensi Event `dispatching` dan `dispatchState: 'not_sent'` Saat Pembatalan

## 1. Ringkasan Masalah

Pada modul `src/agent/execution/dispatch.ts` (baris 65-67):
```typescript
await context.emit({ type: 'tool_call_dispatching', toolCallId: plan.call.id, tool });
const after = dispatchStop(plan, context);
if (after !== undefined) return notDispatched(after);
```

Perhatikan urutan eksekusi:
1. Event `tool_call_dispatching` di-emit terlebih dahulu ke runtime. Pada sesi durable PostgreSQL (`persistEvent` -> `dispatchCommands`), pemanggilan ini mencatat ke database bahwa tool beralih status ke `'dispatching'`.
2. Kemudian, sistem mengecek apakah ada pembatalan (*cancellation*) atau batas limit yang tercapai tepat setelah emit tersebut (`after !== undefined`).
3. Jika ya, fungsi memanggil `notDispatched(after)` yang menghasilkan objek:
   ```typescript
   { dispatched: false, stopped, outcome: ... }
   ```
4. Di `src/agent/execution/execute-calls.ts` (baris 51, 68-70):
   ```typescript
   function undispatched(call: ToolCall, result: DispatchResult, context: ExecutionContext): Settled {
     ...
     return {
       message: rejectionMessage(context.nextMessageId(), call, rejection),
       report: report(call, result.stopped === 'cancelled' ? 'cancelled' : 'rejected', {
         failureCode: rejection.code, dispatchState: 'not_sent', // <--- DRIFT
       }),
       ...
     };
   }
   ```

## 2. Analisis State Drift

Terjadi kontradiksi semantik antara database ledger dan loop memory:
- **Di Database:** Status tool call telah dicatat sebagai `dispatching` (karena event `tool_call_dispatching` sudah di-commit).
- **Di Report Loop:** Laporan eksekusi mencatat `dispatchState: 'not_sent'`.

Jika terjadi proses *crash recovery*, modul recovery membaca ledger database dan mengasumsikan aksi tersebut berada dalam fase in-flight/dispatching, sementara report memori menyatakan aksi belum pernah dikirim.

## 3. Solusi & Rekomendasi

1. Lakukan pengecekan pembatalan dan batas anggaran *sebelum* memancarkan event `tool_call_dispatching`.
2. Jika pembatalan terjadi *setelah* intent berhasil dipersistensikan, emit event transisi pembatalan yang eksplisit ke database ledger (`tool_call_cancelled_before_transport`), atau pastikan `report` menandai `dispatchState` secara konsisten dengan status rekonsiliasi yang sesungguhnya.

## Re-audit (Claude, 17 November 2026): bukan bug

`src/application/durable/tool-commands.ts:52` sudah merekonsiliasi: row `dispatching` yang dilaporkan `not_sent` menjadi
`retry_wait` (evidence `known_not_applied`), lalu `cancelled`. Bila crash terjadi antara emit dan transition, status
diperlakukan sebagai *unknown*. Itu konservatif dan disengaja. Tidak ada perubahan kode.
