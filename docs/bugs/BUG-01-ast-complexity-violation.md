# BUG-01: AST Complexity Gate Violation Menggagalkan CI

## 1. Ringkasan Masalah

Pada saat menjalankan perintah verifikasi utama:
```text
npm run check
```
Proses gagal (*exit code 1*) pada tahapan `lint` dan `check:architecture` dengan pesan diagnostik:
```text
src/contracts/context/budget.ts:9 [COMPLEXITY] resolveContextBudget: complexity 11 exceeds 10
lint: 1 violation(s)
architecture: 1 violation(s)
```

## 2. Analisis Penyebab (*Root Cause*)

File `src/contracts/context/budget.ts` dibuat sebagai bagian dari pekerjaan P07-01 yang belum selesai (*in-progress*), namun sudah diikutsertakan ke dalam pohon `src/`.

Fungsi `resolveContextBudget` pada baris 9-16 mengimplementasikan validasi berlapis dengan loop dan banyak operator logika ternary / OR:
```typescript
export function resolveContextBudget(input: Partial<ContextBudget> = {}): ContextBudget {
  const resolved = { ...DEFAULT_CONTEXT_BUDGET, ...input };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Object.hasOwn(DEFAULT_CONTEXT_BUDGET, key) || !Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid context budget');
  }
  if (resolved.windowTokens > 10000000 || resolved.maxInputBytes > 16777216 || resolved.maxSummaryBytes > 65536
    || resolved.recentTurns > 100 || resolved.framingReserveTokens >= resolved.windowTokens) throw new RangeError('Invalid context ceiling');
  return Object.freeze(resolved);
}
```
AST checker (`scripts/lib/ast.mjs`) menghitung *cyclomatic complexity* fungsi tersebut sebesar 11, melampaui batas ketat arsitektur yaitu maksimal 10.

Selain itu, file ini belum diimpor oleh modul mana pun dalam fase P00-P06.

## 3. Dampak

- Seluruh CI / pipeline verifikasi lokal (`npm run check`) terblokir.
- Kontrak arsitektur (*AST gate*) yang ditetapkan sejak P00 dilanggar.

## 4. Solusi & Rekomendasi

1. Pecah fungsi validasi menjadi dua fungsi pembantu yang lebih kecil:
   - `validateKeys(resolved)`: Memeriksa integritas key dan tipe integer positif.
   - `validateCeilings(resolved)`: Memeriksa batas atas angka.
2. Dengan memecah validasi, kompleksitas siklomatis masing-masing fungsi turun menjadi $\le$ 6, sehingga mematuhi standar arsitektur.
