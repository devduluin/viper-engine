# BUG-04: Worker Poison Pill & Infinite Fast-Retry Loop pada Run yang Rusak

## 1. Ringkasan Masalah

Pada implementasi durable execution worker:
- `src/application/durable/driver.ts` (baris 42-48, 63-66)
- `src/adapters/persistence/postgres/lease-store.ts` (baris 12-15, 63-68)
- `src/adapters/persistence/postgres/worker-control.ts` (baris 39-47)

Ketika terjadi error yang tidak tertangani (*unexpected exception*, misalnya syntax error, bug deserialisasi, atau kegagalan internal), sistem masuk ke dalam siklus **infinite retry spin-loop** tanpa mekanisme *dead-letter* atau batas maksimal percobaan (*max attempts threshold*).

## 2. Alur Terjadinya Masalah

1. Worker mengambil tugas via `claimNext()`: Run berstatus `'running'`.
2. Terjadi unhandled error di dalam `execute()` atau `prepare()`.
3. Di dalam blok `finally` pada `src/application/durable/driver.ts`:
   ```typescript
   await this.deps.leases.release(claim.runId, claim.lease, this.deps.clock.now()).catch(() => undefined);
   ```
   Metode `release()` mengatur `lease_owner = NULL` dan `lease_expires_at = NULL`.
4. Namun, status run di tabel `viper_engine.runs` **tetap berstatus `'running'`**.
5. Pada polling worker berikutnya, query `CLAIMABLE`:
   ```sql
   status IN ('queued', 'running') AND (lease_expires_at IS NULL OR ...)
   ```
   melihat run ini kembali sebagai kandidat yang sah dan langsung mengklaimnya kembali.
6. Pada `PostgresWorkerControl`, field `failures` di tabel `run_deliveries` memang bertambah, namun **tidak ada logika untuk mengubah status run menjadi `'failed'`** ketika `failures` telah melampaui ambang tertentu (misal 5 atau 10 kali).
7. Pada runtime mandiri (di mana hook `onDeliveryFailure` tidak dikonfigurasi), worker langsung mengambil run tersebut seketika dalam putaran loop milidetik yang sama (*fast spin-loop*).

## 3. Dampak

- **CPU Spiking & Resource Exhaustion**: Worker menghabiskan siklus CPU dan bandwidth database untuk mencoba kembali tugas yang pasti gagal.
- **Log Flooding**: Database dan terminal dibanjiri log kegagalan yang sama berulang kali.
- **Run Terjebak Selamanya**: Pengguna tidak pernah melihat status akhir `failed`, melainkan run tampak "sedang berjalan" tanpa pernah selesai.

## 4. Solusi & Rekomendasi

1. Tambahkan `maxDeliveryFailures` (misalnya default 5 kali) di `WorkerRetryPolicy`.
2. Di dalam `PostgresWorkerControl.defer()` atau di `driver.failure()`:
   Jika `failures >= maxDeliveryFailures`, jangan jadwalkan ulang run; ubah status run di `viper_engine.runs` secara atomik menjadi `status = 'failed'` dengan `failure_reason = 'max_delivery_attempts_exceeded'`.
3. Terbitkan event `run.stopped` dengan status `failed` agar klien dan event stream mengetahuinya.

## Re-audit dan status (Claude, 17 November 2026)

Klaim "spin-loop" **overstated**. Sebelum perbaikan sudah ada:

- backoff 1 detik sampai 5 menit (`PostgresWorkerControl`);
- claim yang menghormati `run_deliveries.available_at`;
- deadline run default 120 detik.

Yang benar-benar kurang adalah batas jumlah percobaan. Run yang gagal di tahap setup tidak pernah sampai ke pengecekan
deadline, jadi diulang tiap 5 menit tanpa akhir.

**FIXED.**

- `createEngineWorker` punya opsi `maxDeliveryFailures` (default 20, sekitar 1,5 jam dengan backoff default).
- Setelah batas itu tercapai, `src/bootstrap/worker/dead-letter.ts` mengakhiri run sebagai `failed` (event `run.failed`,
  reason `delivery_failures`) di bawah lease milik worker yang gagal. Run `queued` dipindah dulu ke `running`.
- Run yang masih punya tool call belum settled ditolak oleh aturan settlement store dan tetap di-defer. Efek yang sedang
  berjalan tidak boleh tersembunyi.
- Test:
  - unit `tests/unit/worker/dead-letter-config.test.ts`;
  - integration `worker-host.test.ts`: run dengan setup yang selalu gagal berakhir `failed` setelah 2 kegagalan, tanpa
    memanggil model.
