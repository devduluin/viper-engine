# BUG-09: Remediasi BUG-03 menambahkan model Claude 3.x yang sudah pensiun

Ditemukan pada re-audit Claude (17 November 2026). Severity: **HIGH** (regresi dari remediasi).

## Masalah

BUG-03 menyebut `claude-opus-5-5` sebagai model fiktif. Klaim itu **salah**. Remediasinya menambahkan model
Claude 3.x ke `FALLBACK_MODELS` di `src/adapters/models/anthropic/to-request.ts`:

```
claude-3-7-sonnet-20250219, claude-3-5-sonnet-20241022, claude-3-5-sonnet-latest,
claude-3-5-haiku-20241022, claude-3-5-haiku-latest, claude-3-opus-20240229
```

## Bukti

`GET https://api.anthropic.com/v1/models` dengan API key proyek (17 November 2026) mengembalikan 14 model.
Daftar itu memuat `claude-opus-5-5`, `claude-sonnet-5-5`, dan `claude-fable-5-2`. **Tidak satu pun** model 3.x di atas ada,
karena semuanya sudah pensiun. Bukti kedua: live eval Workin memakai `claude-opus-5-5` dan berjalan normal (17/17 dan 22/23,
lihat `evals/datasets/workin-live/README.md`).

## Dampak

Kalau fallback memilih salah satu model 3.x, request gagal dengan `not_found_error`. Model lama itu juga tidak mendukung
`thinking: {type: "adaptive"}` dan effort yang dipakai adapter. Jadi fallback berubah menjadi sumber error, bukan jaring pengaman.

## Rekomendasi

- Revert keenam entri 3.x dari `FALLBACK_MODELS`.
- Tandai BUG-03 sebagai **invalid**.
- Bila daftar fallback perlu diverifikasi, pakai `/v1/models`, bukan ingatan model.
- Tambahkan unit test yang menjaga isi `FALLBACK_MODELS`.

Owner: lane engine (GPT). Re-audit ini tidak mengubah kode.

## Status: FIXED (Claude, 17 November 2026)

- `FALLBACK_MODELS` sudah kembali ke model saat ini saja: `claude-fable-5-2`, `claude-fable-5-1`, `claude-opus-5-5`,
  `claude-opus-5`, `claude-sonnet-5-5`.
- Test baru di `tests/contract/model-anthropic/gateway.test.ts` memastikan daftar itu tidak memuat id `claude-3*`.
