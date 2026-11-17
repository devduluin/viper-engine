# BUG-12: opsi `stderr: 'pipe'` pada transport stdio tidak punya konsumen

Ditemukan pada re-audit Claude (17 November 2026). Severity: **LOW**.

## Masalah

Remediasi BUG-07 (`src/adapters/mcp/client/transport.ts`) mengubah default menjadi `stderr: config.stderr ?? 'inherit'`
dan menambah pilihan `'pipe'`. Ada dua catatan:

1. **`'pipe'` tanpa pembaca.** Tidak ada kode yang membaca `transport.stderr`. Bila server MCP banyak menulis ke
   stderr, buffer pipe OS (sekitar 64 KB) penuh dan child process bisa *block* saat menulis. Hasilnya tool call hang sampai
   timeout. Opsi ini lebih berbahaya daripada `'ignore'`.
2. **`'inherit'` tidak menyelesaikan masalah aslinya.** Rekomendasi BUG-07 adalah menangkap stderr ke buffer terbatas
   lalu menyertakannya di log atau di `McpFailure`. `'inherit'` hanya mencampur stderr child ke stderr host: tanpa
   korelasi ke connection atau run, dan bisa memuat data sensitif dari server pihak ketiga ke log host.

## Rekomendasi

- Hapus `'pipe'` dari tipe publik, atau implementasikan konsumen ring buffer (misalnya 16 KB) yang dipotong rapi dan
  disertakan saat koneksi gagal atau putus.
- Default sebaiknya tetap tidak bocor ke log host (`'ignore'`, atau buffer internal), sesuai rekomendasi asli BUG-07.

## Status: FIXED (Claude, 17 November 2026)

- Opsi `'pipe'` dihapus dari tipe publik. Pilihan sekarang `'capture' | 'ignore' | 'inherit'`, dengan default `'capture'`.
- `'capture'` selalu membaca stderr child process sampai habis, sehingga child tidak pernah *block*. Hanya
  `STDERR_TAIL_CHARS` (8 KB) terakhir yang disimpan dan bisa dibaca lewat `stderrTail(transport)` / `McpSession.stderr`.
- Bila connect stdio gagal, error yang dilempar membawa properti non-enumerable `stderr`. Isinya untuk logging host saja:
  tidak masuk ke `message`, jadi tidak sampai ke model.
- Test `tests/contract/mcp-client/stdio-stderr.test.ts` mencakup:
  - server yang crash: tail tersedia di error, tidak ada di message;
  - output 200 KB: stream terkuras habis dan tail terbatas;
  - mode `ignore` dan transport HTTP: tanpa tail.
