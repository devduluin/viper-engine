# Scoped recall and user notes

P07-02 menyediakan `createEngineRecall(pool)` sebagai service untuk host yang sudah mengautentikasi
pengguna. DTO schemaVersion:1 dan storage port bebas UI/SDK model; bisa dipasang pada transport host.
Tidak ada taxonomy knowledge/skill atau vector service. HTTP v1 yang ada tetap dipakai untuk run;
recall/notes saat ini dipanggil lewat library host, belum memiliki route HTTP CRUD khusus.

## Pemakaian host

Terapkan migration **0011_scoped_notes.sql** pada DB engine baru. Contoh memakai scope dari server
authentication, bukan actor/app/tenant yang dikirim di body pengguna:

```ts
import { createEngineRecall, createViperEngine } from 'viper-engine';

const recall = createEngineRecall(pool);
const matches = await recall.search(authenticatedScope, { query: 'Indonesian', limit: 10 });
const note = await recall.createNote(authenticatedScope, {
  conversationId: selectedConversationId,
  messageId: selectedUserMessageId,
});

const engine = createViperEngine(pool, {
  ...hostOptions,
  contextEvidence: (request, { signal }) => {
    signal.throwIfAborted();
    return recall.evidence(request.scope, { limit: 5 });
  },
});
```

Engine tidak mengaktifkan recall otomatis. Host memilih data yang relevan dan menyalurkan scope
server pada setiap lookup. Callback contextEvidence dipanggil ulang sebelum setiap model call,
di bawah deadline/AbortSignal run. Service tidak membuka pool/server, memuat .env, memanggil model,
menambah tool atau menciptakan notes secara otomatis.

## Search dan trust

`search(scope, {query, conversationId?, limit?})` mencari **text blocks** history dengan substring
literal case-insensitive di PostgreSQL. `%`, `_`, quote dan SQL-looking input menjadi data biasa.
Query dibatasi 256 UTF8 bytes dan minimal dua nonblank code units; limit default20, maksimum50.
Hasil terurut timestamp/ID terbaru, excerpt maksimum512 karakter, hasMore menunjukkan truncation.
Tidak ada semantic ranking atau cursor paging; refine query/conversation atau limit untuk hasil lain.

Setiap query memfilter actor/app/tenant. conversationId milik scope lain menghasilkan hasil kosong,
bukan akses lintas pengguna. Assistant/tool output dapat muncul sebagai historical evidence dengan
role/outcome dan trust:untrusted_history. Search bukan verifikasi fakta, keputusan approval atau grant.
System/private run instructions tidak termasuk history yang dicari. Media/JSON-only blocks tidak
diindeks sebagai teks dan URL tidak di-fetch.

Query dibatasi statement_timeout 5 detik dan owner/recent indexes. Ini baseline basic DB search;
substring search masih dapat memindai history owner besar. Benchmark volume besar/FTS menjadi
follow-up berdasarkan kebutuhan. DB pool acquisition/network timeout tetap dikonfigurasi host.

## Explicit user notes

`createNote(scope, source)` menerima **referensi pesan user text-only** yang sudah tersimpan.
Seluruh teks sumber harus 1..8192 UTF8 bytes, nonblank. Tidak menerima arbitrary note text, role,
verified flag atau klaim actor. Pesan assistant/tool, source owner lain dan source media ditolak.
Jika ingin mengonfirmasi jawaban model, pengguna harus membuat pernyataan user baru terlebih dahulu.

Notes memiliki trust:user_asserted, bukan verified fact. Pemilihan source harus merupakan tindakan
eksplisit host/pengguna. Jawaban model dan suksesnya run tidak pernah otomatis menjadi note.
Metadata menyimpan source conversation/message/position/time, noteId/revision serta waktu perubahan.
Teks dibaca dari immutable source; tidak disalin ke tabel notes atau audit.

| Method | Perilaku |
| --- | --- |
| notes(scope, {query?, limit?}) | Active notes terbaru; literal query opsional, limit1..50 |
| getNote(scope, id) | Current active note atau tombstone deleted, owner-only |
| correctNote(scope, id, revision, newSource) | CAS mengganti source ke user statement baru |
| deleteNote(scope, id, revision) | CAS membuat tombstone dan menghapus current source pointer |
| changes(scope, id, limit?) | Metadata audit terbaru: action/revision/source IDs/time, tanpa text copy |

Correction/delete dan audit row berada dalam satu transaksi, row lock dan revision step. Dua editor
dengan revision sama hanya memiliki satu pemenang; stale caller mendapat REVISION_CONFLICT melalui
shared ApiFailure. Source salah/unsupported menjadi NOT_FOUND/INVALID_STATE. get/changes/correct/delete
milik scope lain selalu NOT_FOUND. Tombstone tidak bisa diaktifkan ulang; buat note baru bila perlu.
Create bukan endpoint idempotent: host jangan otomatis mengulang mutation dengan hasil yang tidak diketahui.

Database composite FK mengikat source user role/conversation/owner dan immutable audit. Trigger
mencatat create/correct/delete termasuk write SQL yang sah. Applied migrations lama tidak diubah.
Current schema mempunyai 18 engine tables ditambah migration ledger.

Deletion menghapus note dari list/search-notes dan future notes evidence, **bukan** menghapus immutable
conversation source, audit provenance atau teks yang pernah dilihat model. Search history yang
diaktifkan eksplisit masih dapat menemukan source lama. Ini bukan fitur penghapusan seluruh data user.

## Context evidence

`evidence(scope, {query?, conversationId?, limit?})` default mengambil sampai5 active notes terbaru.
Tanpa query tidak ada pencarian history otomatis. Dengan query, hasil notes literal diikuti history
untuk mengisi sisa slot. Limit1..10; setiap item membawa excerpt maksimum512 karakter/provenance,
wrapper JSON untrusted_recall_v1 maksimum16KiB. No results menghasilkan array kosong.

Pesan synthetic memakai user role dan peringatan incomplete data, bukan instruksi/fakta/approval.
Engine menolak system/assistant/tool evidence, duplikasi ID dan payload >32KiB sebelum model.
Evidence dipin dalam budget konteks bersama instruksi/catalog; tidak dipangkas untuk memberi ruang
tool. Bila tidak muat, P07-01 menghentikan run sebelum model dengan context_input_limit.

Callback berjalan setiap call sehingga correction/delete yang sudah commit sebelum lookup berikutnya
terlihat pada call tersebut. Lookup yang sedang berjalan memakai snapshot saat dibaca; data yang
sudah dikirim tidak bisa ditarik kembali. Tidak ada cross-call cache. Retrieved evidence tidak disalin
secara terpisah ke canonical conversation, execution checkpoint/excerpt, SSE message.completed atau
grant ledger. Source yang sudah ada di canonical history tetap dapat masuk summary prefix history itu.
Model yang mengutip evidence dalam jawaban menghasilkan history baru yang tetap unverified.

Deadline dapat menghentikan penantian provider; SQL yang sedang berjalan tetap memiliki timeout
sendiri. Provider gagal/hanging tidak membuat automatic tool retry. Model/policy/approval tetap
otoritas pemilihan tindakan; source note tidak dapat mengganti scope, policy atau execution budget.

## Demo dan bukti

`npm run example:recall` memakai VIPER_TEST_DB_* eksplisit pada server loopback dan generated
viper_it_* DB. Tidak memuat .env, key atau live model/MCP Workin. Demo membuat explicit user note,
menjalankan SDK scripted model + MCP lokal, lalu correction/delete dan audit. Fixture support berada
di luar production src. Jangan arahkan konfigurasi ke database aplikasi.

`npm run check` mencakup batas input/evidence/role/deadline; integrasi terpisah mencakup ownership,
FK source role, correction race/audit/tombstone, real model SDK/MCP dan correction/delete di antara
dua model calls. Lihat [handoff](handoffs/P07-02.md) dan [progress](progress.md) untuk angka aktual.
Belum mengukur live answer quality, semantik recall skala besar, billing atau perbandingan Hermes/V4.
