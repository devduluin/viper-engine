# P08-01 audit (Claude, 17 November 2026)

Audit independen atas klaim GPT "P08-01 DONE". Kesimpulan: **sah**, dengan dua perbaikan kecil.

## Verifikasi ulang

| Perintah | Hasil |
| --- | --- |
| `npm run eval:offline` | PASS: unit 292 + contract 152, source drift kosong |
| `npm run eval:regression` dengan `VIPER_TEST_DB_*` eksplisit | Unit 292, contract 152, integration 175 lulus; engine trials **60/60** |

Run kedua berstatus `passed:false` hanya karena **source drift**: tiga file baru `tests/support/comparison/*`
muncul selama run (P08-02 GPT dikerjakan paralel). Detektor drift bekerja sesuai desain; ini bukan cacat
P08-01. Report harus dibuat ulang saat tree tidak sedang diedit.

Yang sudah baik:

- grading memakai efek, audit, dan approval yang dipersist, bukan teks model;
- trial kosong, duplikat, atau hilang tidak bisa lolos;
- cleanup yang gagal menggagalkan report;
- env child dibatasi ke `VIPER_TEST_DB_*`.

## Perbaikan (di working tree, file milik GPT belum di-commit)

1. **Pesan fatal hilang.** `examples/regression.ts` hanya menyimpan `error.name` ("Error"), sehingga
   penyebabnya tidak terlihat. Sekarang tersimpan name + message (maks. 500 karakter), contoh
   `"Error: VIPER_TEST_DB_HOST is required"`.
2. **Identitas kode.** Repo sekarang git. `regressionManifest` menambahkan `git: { commit, dirty }` di samping
   hash source (yang tetap otoritatif). Label `no-git-claim` dihapus.

## Catatan untuk GPT

- `eval:regression` sengaja tidak membaca `.env`. Ini sesuai desain, tetapi `.env` lokal sekarang berisi
  `VIPER_TEST_DB_*` (database `viper_engine_test`). Pertimbangkan untuk mendokumentasikan cara menjalankannya
  di runbook P08-03.
- Lint/architecture: `tests/support/comparison/regression-raw.ts:15` kompleksitas 11 (P08-02 yang sedang berjalan).
- Migration baru `0013_model_call_cache_usage.sql` (X01, Claude). P08-02 yang butuh migration harus memakai 0014.
- Usage di `model_calls` sekarang punya `cache_read_tokens` / `cache_write_tokens` (lihat
  [engine extensions plan](../engine-extensions-plan.md)).
