# BUG-03: Model Fiktif dan Beta Headers Tidak Valid pada Anthropic Adapter

## 1. Ringkasan Masalah

Pada modul integrasi Anthropic:
- `src/bootstrap/model-config.ts` (baris 43)
- `src/adapters/models/anthropic/to-request.ts` (baris 19-24, 122-127)

Terdapat konfigurasi model dan API payload yang **tidak sesuai dengan spesifikasi resmi Anthropic API**:

1. **Default Model Fiktif**:
   ```typescript
   const model = text(env, 'VIPER_MODEL', 'claude-opus-5-5');
   ```
   Daftar model fallback juga mencantumkan nama yang belum ada:
   `'claude-fable-5-2'`, `'claude-fable-5-1'`, `'claude-opus-5-5'`, `'claude-sonnet-5-5'`.
   
   Model resmi yang saat ini aktif di API Anthropic adalah:
   `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`.

2. **Beta Headers Fiktif**:
   ```typescript
   const BINDING_BETA = 'thinking-binding-controls-2026-08-01';
   const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
   ```

3. **Sintaks Thinking Tidak Sesuai**:
   ```typescript
   thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }
   ```
   Pada SDK resmi Anthropic (`@anthropic-ai/sdk`), format thinking adalah:
   `{ type: 'enabled', budget_tokens: number }` (atau budget tokens adaptif per model 3.7).

## 2. Analisis Penyebab

Agen AI pengembang sebelumnya melakukan ekstrapolasi/halusinasi spesifikasi masa depan (*hallucinated future beta headers and model identifiers*). Seluruh tes unit untuk adapter Anthropic menggunakan stub `fake-api.ts` sehingga panggilan HTTP ke API nyata Anthropic tidak pernah terverifikasi dalam pipeline otomatis.

## 3. Dampak

Jika pengguna mengisi `ANTHROPIC_API_KEY` valid di `.env` dan menjalankan `npm run model:smoke`, API Anthropic akan menolak request dengan status **HTTP 400 Bad Request** atau **HTTP 404 Not Found** (model `claude-opus-5-5` tidak ditemukan atau beta header ditolak).

## 4. Solusi & Rekomendasi

1. Ubah default model di `model-config.ts` menjadi model resmi (misal: `claude-3-7-sonnet-20250219` atau `claude-3-5-sonnet-latest`).
2. Hapus header beta fiktif (`thinking-binding-controls-2026-08-01` dan `server-side-fallback-2026-07-01`).
3. Sesuaikan struktur parameter `thinking` dengan skema resmi `@anthropic-ai/sdk`.

## Re-audit (Claude, 17 November 2026): INVALID

`/v1/models` mencantumkan `claude-opus-5-5`, `claude-sonnet-5-5`, dan `claude-fable-5-2`, dan live eval Workin berjalan
dengan `claude-opus-5-5`. Remediasi yang menambahkan model Claude 3.x sudah di-revert. Lihat
[BUG-09](BUG-09-retired-claude3-fallback-models.md).
