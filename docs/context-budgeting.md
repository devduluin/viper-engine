# Context budgeting and compression

P07-01 membatasi view konteks sebelum setiap model call. Canonical history, call identity dan
approval tetap utuh. Implementasi deterministik ini mengurangi history lama yang dikirim ke model,
tanpa mengganti bukti eksekusi dengan ringkasan.

## Konfigurasi host

`createViperEngine` dan `createEngineWorker` menerapkan budget default berikut. Sesuaikan
window dengan provider/model/deployment yang sebenarnya; default bukan metadata provider.

```ts
const engine = createViperEngine(pool, {
  // model, credentials, resolveEndpoint, connections dan policy disuplai host.
  ...hostOptions,
  context: {
    windowTokens: 65536,
    framingReserveTokens: 2048,
    maxInputBytes: 1048576,
    maxSummaryBytes: 4096,
    recentTurns: 2,
  },
});
```

`estimatedInputTokens + maxOutputTokens + framingReserveTokens <= windowTokens` dan ukuran JSON
ModelRequest internal <= maxInputBytes wajib terpenuhi sebelum model-start/gateway invocation.
Perhitungan mencakup instruksi, history terpilih, nama/schema/deskripsi tool, serta response schema.
Byte limit juga mencakup inline media dan reference URI. Wire SDK/provider dapat memiliki framing
berbeda; ini bukan pembatas pasti ukuran HTTP request provider atau hitungan token/billing nyata.

Text estimator P02 bersifat approximate dan belum menghitung token media. Flag hasUnpricedMedia
dan excludesProviderFraming tetap dilaporkan. Reserve framing adalah margin host, bukan hasil
tokenizer provider. Provider usage asli tetap terpisah di RunSnapshot.usage.

Field harus integer positif. maxInputBytes maksimum 16 MiB, maxSummaryBytes 1024..65536 bytes,
recentTurns 1..100, windowTokens maksimum 10000000 dan reserve < window. Byte/token limits yang
tidak cukup untuk konteks wajib menghasilkan stop reason context_input_limit, bukan silent truncation.
Public terminal event memakai BUDGET_EXCEEDED; run dapat partial bila ada outcome unknown.

Low-level runAgentLoop/createDurableRunDriver mengaktifkan budgeting bila input/configure.context
disediakan. Ini menjaga kompatibilitas pemanggil kontrak lama. Engine factory default menerapkannya.

## Seleksi history

1. Validasi seluruh history asli, scope/conversation, pairing, IDs, instructions dan kemampuan model.
   Data invalid/unsupported tidak disembunyikan dengan membuang pesan sebelum validasi.
2. Jika konteks lengkap muat, gunakan seluruh history tanpa pesan summary tambahan.
3. Jika tidak muat, pertahankan suffix dari turn terbaru. Batas turn adalah user message di luar
   batch tool yang belum lengkap; parallel/reversed result tetap bersama proposalnya.
4. Seluruh current run, termasuk task awal, clarification dan completed/pending tool evidence,
   tetap dipertahankan. Anchor berasal dari run-message IDs storage atau checkpoint sebelumnya;
   low-level caller tanpa anchor memakai latest user saat persiapan pertama.
5. Turn dengan tool outcome unknown juga dipertahankan. Karena seleksi berupa suffix kontigu,
   unknown lama dapat menahan seluruh history setelahnya. Tidak menebak hasil atau mengulang tool.
6. Minimal recentTurns terbaru utuh. Hanya prefix turn lengkap sebelum pekerjaan yang dilindungi
   dapat dihilangkan dari request. Pencarian cutoff bounded memilih suffix yang memenuhi dua limit.
7. Jika suffix wajib plus instruksi/catalog/reserve/summary masih terlalu besar, berhenti sebelum
   model dipanggil. Tidak memangkas parameter approval, hasil tool parsial, instruksi host atau schema.

Kebijakan ini recency-first. Belum merupakan semantic search, vector recall atau summary LLM.
Pin seluruh current run adalah pilihan konservatif: run aktif yang panjang bisa mencapai limit.
P07-02 recall/notes dan strategi compression aktif lain memerlukan bukti dan scope tersendiri.

## Extractive summary checkpoint

Prefix yang dihilangkan diberi bounded sample: maksimal tiga pesan awal dan tiga pesan akhir,
dipotong dengan batas UTF-8. Role, message ID, nama tool dan outcome menjadi provenance bila masuk
sample. Media diganti penanda, tidak di-fetch. Truncation tetap dapat menghilangkan detail; summary
tidak menjamin fakta lama lengkap. Canonical history masih dapat dibaca melalui conversation API.

Synthetic message memakai user role dan wrapper historical_excerpts_v1 yang menyatakan untrusted,
incomplete data. Data dari user/model/MCP tidak dipromosikan ke system role, permission atau fakta
terverifikasi. Approval tetap dari ledger/policy host. Tidak ada summarizer model call tambahan.

ContextCheckpoint v1 mencatat conversation/run, original active anchor, coveredMessages,
domain-separated SHA-256 sumber dan excerpt serta report. Scope actor/app/tenant masuk digest
melalui field eksplisit; branded TrustedScope tidak diserialisasi sebagai JSON. Digest bukan MAC,
signature atau authentication. Excerpt direkonstruksi dan diverifikasi dari history asli.

Checkpoint dan original ContextBudget disimpan bersama model-start/audit pada journal yang sama,
di bawah lease dan CAS revision. Tidak ada tabel/migration baru; runtime_checkpoints.state mendapat
field opsional baru dan reader tetap menerima durable state v1 lama. Budget tersimpan dipakai saat
resume meskipun konfigurasi host berubah; budget baru berlaku pada run baru. Policy/access tetap
direvalidasi sebagaimana sebelumnya, terpisah dari ceiling konteks yang dipin.

Saat restore, validasi digest, excerpt, binding, anchor dan safe turn boundary berjalan sebelum
approved tool dapat dilanjutkan, termasuk ketika history masih punya pending calls. Corruption
menolak eksekusi; explicit cancellation dapat membuang context view rusak agar cleanup tetap berjalan.
History, approval, output/repetition counters dan call outcome tidak pernah diganti oleh summary.
Model yang mengusulkan ulang call ID dari pesan terkompres tetap ditolak dari canonical history.

Tidak ada physical history pruning atau pengurangan beban database. Snapshot reader tetap memuat
bounded full history (default 10000 pesan) dan ledger untuk recovery; log melebihi batas memerlukan
desain storage/retention terpisah. P07-01 membatasi view model, bukan memperbesar batas storage.

## Observability

RunSnapshot.context bersifat **opsional**, additive dalam v1, hanya berisi angka/flag report:

| Field | Arti |
| --- | --- |
| inputMessages | Jumlah full request messages termasuk instruksi |
| selectedMessages | Jumlah request messages setelah seleksi, termasuk synthetic summary bila ada |
| omittedMessages | Banyak canonical history messages yang digantikan oleh excerpt; dapat nol |
| beforeTokens / afterTokens | Estimasi text/schema sebelum dan sesudah seleksi |
| inputBytes | Byte JSON internal ModelRequest yang disiapkan |
| approximate / hasUnpricedMedia / excludesProviderFraming | Batas keakuratan estimate |

Ini report call terakhir yang telah di-commit pada model-start, bukan total token usage.
Observer internal model_call_started juga menerima checkpoint. Jangan log excerpt/source content
ke telemetry publik. API tidak mengekspor excerpt/digest/instruksi dari checkpoint; synthetic message
tidak ditulis ke conversation history, SSE message.completed atau tool-call ledger.

## Validasi dan ablation offline

`npm run context:report` menjalankan fixture deterministik unbounded-versus-compressed dan menulis
artifacts/context/p07-01.json. Command tidak memuat .env, key, database atau network provider.

| Fixture stock read | Sebelum | Sesudah |
| --- | --- | --- |
| Request pertama, internal bytes | 50070 | 1540 |
| Request pertama, perkiraan tokens | 11705 | 298 |
| Request setelah hasil tool, bytes | 50349 | 1819 |
| Model calls / tool calls | 2 / 1 | 2 / 1 |

Scripted final/status sama, namun script tidak mengukur reasoning quality atau retention detail
pada live model. Tidak ada klaim hemat billing tertentu, kualitas setara live, atau unggul Hermes/V4.
Tests juga mencakup byte/token-only pressure, Unicode/escaped JSON, reversed parallel results,
pending/unknown evidence, hidden reused ID, ownership/digest/tamper, input/approval resume,
real SDK/MCP/HTTP projection dan OS-kill setelah atomic checkpoint commit.

Lihat [handoff](handoffs/P07-01.md), [review](reviews/P07-01.md), [composition](engine-composition.md)
dan [progress](progress.md) untuk evidence aktual dan batas scope.
