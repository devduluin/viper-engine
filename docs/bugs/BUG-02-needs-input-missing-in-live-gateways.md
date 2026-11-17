# BUG-02: Live Model Gateways Tidak Pernah Menghasilkan Decision `needs_input`

## 1. Ringkasan Masalah

Dalam kontrak model (`src/contracts/models/decision.ts`), ada tiga jenis keputusan model (`ModelDecision`):
1. `tool_calls`: Model ingin memanggil tools.
2. `needs_input`: Model membutuhkan klarifikasi/input tambahan dari pengguna.
3. `final`: Model telah selesai dan memberikan jawaban akhir.

Namun, pada adapter provider live:
- Anthropic: `src/adapters/models/anthropic/from-response.ts` (baris 53-56)
- OpenAI: `src/adapters/models/openai/from-response.ts` (baris 55-57)

Kedua adapter tersebut hanya mengimplementasikan logika biner:
```typescript
const decision = calls.length > 0
  ? parseModelDecision({ kind: 'tool_calls', calls, content })
  : parseModelDecision({ kind: 'final', content });
```

Keputusan `needs_input` sama sekali **tidak pernah dibuat oleh provider model riil**.

## 2. Analisis Bukti Pengujian (*Testing Gap*)

Seluruh unit test dan integration test yang memverifikasi flow `needs_input` (misalnya di `tests/integration/postgres/durable-driver.test.ts` dan `tests/unit/runtime/run-loop.test.ts`) menggunakan **ScriptedModel mock** di mana `{ kind: 'needs_input', question: 'Which item?' }` diinjeksi secara manual oleh penguji.

Tidak ada satu pun tes dengan live provider yang mampu menghasilkan `needs_input`.

## 3. Dampak Serius

Jika model (Claude atau GPT) menjawab secara tekstual:
> *"Berapa nominal yang ingin Anda transfer dan ke rekening siapa?"*

Karena `calls.length === 0`, adapter mem-parsing respons tersebut sebagai `{ kind: 'final', content }`.

Di dalam `src/agent/runtime/run-loop.ts`:
```typescript
if (decision.kind === 'final') return finalAnswerStop(context.state.reports);
```
Sistem langsung menganggap tugas telah **SELESAI (`completed` / `final_answer`)**!  
Run tidak pernah berhenti di status `waiting_for_input`, sehingga pengguna tidak bisa merespons klarifikasi dalam siklus yang sama.

## 4. Solusi & Rekomendasi

1. **Synthetic Tool Pattern (Direkomendasikan)**:  
   Daftarkan tool bawaan runtime bernama `clarify` atau `ask_user` ke dalam daftar tools yang diberikan ke model. Jika model membutuhkan input dari user, model memanggil tool ini, dan adapter memetakannya ke `needs_input`.
2. **Atau Structured Schema Extension**:  
   Jika model tidak memanggil tools dan menggunakan response schema / format terstruktur, parse payload teks untuk membedakan apakah itu pernyataan akhir atau pertanyaan klarifikasi sebelum memutuskan `kind: 'final'`.

## Re-audit (Claude, 17 November 2026)

Remediasi berbasis nama tool dihapus karena merupakan kode mati dengan risiko bentrok nama. Lihat
[BUG-10](BUG-10-clarification-tool-never-offered.md). Kebutuhan `needs_input` dari model live tetap terbuka sebagai
keputusan desain.
