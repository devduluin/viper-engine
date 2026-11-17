# Headless HTTP/SSE integration

P06-04 menyediakan helper Node 22 `createEngineClient` tanpa Next.js, UI, desktop SDK atau akses DB.
Server tetap memegang identity, policy, approval dan durable execution. Client memakai v1 HTTP/SSE
yang sama dengan client lain. Lihat [HTTP](http-api.md), [stream](event-stream.md) dan [worker](worker-host.md).

## Pemakaian

Build library dengan `npm run build`. Contoh Node ESM dari root project:

```js
import { createEngineClient } from './dist/index.js';

const client = createEngineClient({
  baseUrl: 'https://engine.example.com',
  getToken: async () => session.accessToken,
});
const capabilities = await client.capabilities();
const conversation = await client.createConversation({ title: 'Stock review' });
const accepted = await client.startRun(conversation.conversationId, {
  input: { content: [{ type: 'text', text: 'Check stock for item a' }] },
}, 'host-generated-stable-key');

for await (const update of client.watch(accepted.runId)) {
  if (update.kind === 'event') {
    await applyEvent(update.event);
    await saveCheckpoint(update.checkpoint);
  } else {
    await replaceView(update.snapshot);
  }
}
```

`session`, `applyEvent`, `saveCheckpoint` dan `replaceView` adalah tanggung jawab host.
Client construction tidak melakukan I/O. URL menerima origin HTTPS, atau HTTP loopback untuk dev;
tidak menerima credentials/query/path di URL. Token diperoleh ulang untuk setiap request melalui
callback, memakai Authorization header, redirect:error dan credentials:omit. CORS/cookie/CSRF,
token issuance, proxy TLS serta deployment menjadi tanggung jawab host; bukan fitur contoh ini.

Persist conversationId/runId, inputId, idempotency key dan checkpoint di host. Ulangi start dengan
conversation/key/payload yang sama hanya setelah keputusan host; jangan membuat key baru untuk
request dengan hasil yang belum diketahui. Tidak ada automatic retry untuk mutation. Timeout
bukan bukti rollback. Batas retention idempotency mengikuti capabilities server.

## Mengamati dan menyambungkan ulang

`events(runId, {cursor, signal})` membaca satu koneksi SSE dan mengembalikan `{event,cursor}`.
`watch(runId, {checkpoint, signal, maxReconnects, reconnectMs, maxReconnectMs})` menambahkan:

- Snapshot awal beserta cursor/highwater konsisten; terminal snapshot langsung selesai.
- Replay dari checkpoint yang diberikan, termasuk jika run sudah terminal tetapi ada event tertinggal.
- Dedup berdasarkan sequence dan pemeriksaan urutan/run/event envelope. Cursor baru diterapkan
  di iterator setelah pemanggil melanjutkan dari `yield`; host menyimpannya setelah event diterapkan.
- Reconnect operasi baca untuk EOF/network/timeout/quota/5xx; default maksimum 8 reconnect kumulatif,
  backoff 250ms sampai 5000ms. Tidak mengulang model/tool/run/input/approval.
- Snapshot recovery (`recovered:true`) untuk cursor expired/invalid, gap atau event type baru;
  client mengganti view dari snapshot dan melanjutkan setelah highwater. Event lama yang telah
  dipangkas tidak dipulihkan satu per satu. Ini bukan jaminan audit consumer exactly-once.
- Snapshot akhir setelah event terminal, termasuk usage. Read akhir yang gagal dapat diulang
  tanpa membuka ulang stream terminal. Error auth, abort, schema/version atau payload berhenti.

Cursor bukan eventId atau sequence. Jangan mengarang cursor dari nomor urut. Checkpoint harus
milik run yang sama dan sequence tidak boleh melebihi snapshot. Jika recovery snapshot sendiri
gagal, pemanggil mendapat error dan dapat menyambung ulang secara eksplisit dengan checkpointnya.
Read awal tidak otomatis diulang. `EngineClientFailure` membawa code/status/recovery/requestId
tanpa raw body, token atau provider diagnostics. Error bukan tanda izin mengulang side effect.

`break`/AbortSignal hanya menutup pembacaan, reader dan timer. Untuk meminta cancellation durable,
panggil `client.cancel(runId)` secara eksplisit. Memutus HTTP tidak menghentikan worker.
Heartbeat/comment tidak mengubah cursor. Delta teks sementara diabaikan; hanya durable message
dan snapshot akhir menjadi bukti. Server saat ini belum mengirim token delta.

## Input dan approval

Saat `run.input_required` atau `approval.required`, ambil snapshot terkini. Snapshot awal/recovery
juga bisa langsung menunjukkan waiting state tanpa event pause baru. Contoh [headless.ts](../examples/headless.ts)
mencakup kedua kondisi tersebut dan mengembalikan waiting snapshot bila callback host tidak tersedia.

Input memakai inputId stabil, expectedRevision dari run, serta content. Approval memakai approvalId,
expectedRevision **approval**, proposal immutable dan keputusan accept/reject dari pengguna/host
tepercaya. Tampilkan nama tool, arguments, scope/binding dan expiry sebelum keputusan. Jangan
menganggap event, model atau MCP output sebagai persetujuan. Saat REVISION_CONFLICT ambil ulang
snapshot dan minta keputusan berdasarkan state terkini; contoh tidak otomatis menerima proposal baru.
User rejection menghasilkan tool-result not_dispatched/rejected_by_user, bukan permission error.
Model menerima alasan tersebut; penolakan exact proposal tetap memblokir dispatch walau policy host
kemudian execute. Lihat [rejection follow-up](handoffs/WORKIN-REJECTION.md) untuk batas dan recovery.

`runHeadlessTask` membuat conversation/run baru setiap pemanggilan. Gunakan untuk satu task baru;
untuk proses host restart, pakai ID tersimpan dan `client.watch`, bukan memanggil helper itu lagi.
Callback onUpdate di-await. Jika host crash setelah mengubah view tetapi sebelum menyimpan
checkpoint, dedup/transaction pada storage host tetap diperlukan.

## Usage, progress dan outcome

RunSnapshot memiliki field **opsional** `usage` agar perubahan v1 tetap additive:

| Field | Arti |
| --- | --- |
| modelCalls | Jumlah attempt audit model, termasuk pending/gagal; bukan jumlah billed requests |
| source | provider, estimate, mixed atau unavailable |
| inputTokens/outputTokens/totalTokens | Sum hanya jika semua attempt memiliki field itu; selainnya null |

Tanpa attempt: source unavailable, seluruh token null. Estimate tidak berubah menjadi provider.
Total tidak dihitung ulang dari partial input/output. Tidak ada harga, monetary cost atau klaim
kesesuaian billing. Aggregate dibaca dalam transaksi snapshot repeatable-read yang sama.
Client juga menerima server v1 lama yang belum mengirim usage; ketiadaan bukan nol.

Step/tool/message events memberi progress, correlation IDs dan hasil. `tool.completed` berarti
success; `tool.failed` membedakan error/unknown. Status completed/partial/failed/cancelled dan
pesan tool di history tetap otoritatif; teks final yang lancar tidak membuktikan keberhasilan tool.
Unknown remote outcome memerlukan reconciliation sebelum keputusan retry oleh host.

## Batas client

| Setting | Default / maksimum |
| --- | --- |
| requestTimeoutMs | 15000ms, integer positif dalam rentang timer Node |
| streamIdleMs | 45000ms tanpa byte; heartbeat mereset idle |
| requestBytes | 1 MiB; diperkecil setelah capabilities, maksimum 1 MiB |
| eventBytes | 1 MiB JSON; diperkecil setelah capabilities, maksimum 1 MiB |
| responseBytes | 4 MiB; maksimum 32 MiB |

SSE frame mendapat tambahan maksimum 4096 bytes untuk framing/cursor; JSON tetap dibatasi
eventBytes. Decoder UTF-8 fatal, frame tidak lengkap saat EOF dibuang dan tidak diakui.
Response menerima field opsional baru, tetapi known fields/types/version tetap divalidasi.
Request tetap memakai schema asli yang ketat. Tidak ada dependency baru atau generated SDK.

## Fixture demo yang dapat dijalankan

`npm run example:headless` menjalankan [fixture-demo.ts](../examples/fixture-demo.ts): PostgreSQL
baru terisolasi, HTTP/SSE nyata, worker nyata, SDK model dengan scripted fetch dan MCP lokal.
Atur VIPER_TEST_DB_HOST/PORT/NAME/USER/PASSWORD/SSL secara eksplisit mengikuti
[P04-01 setup](handoffs/P04-01.md); role review harus boleh CREATE DATABASE pada server loopback.
Command memuat .env bila ada untuk konfigurasi DB; fixture tidak memakai real provider key dan
hanya membuat/drop viper_it_*. Untuk tanpa .env, set env eksplisit lalu jalankan
`node --import tsx examples/fixture-demo.ts`. Demo bisa skip jika VIPER_TEST_DB_HOST tidak diisi;
skip bukan evidence keberhasilan integrasi.
Jangan arahkan ke database aplikasi. File fixture import test support sengaja di luar production src.

Demo read -> exact approved write -> final mencetak progress/status/usage dan writes:1.
Accept callback hanya berlaku pada fixture lokal count=5 yang diketahui, bukan policy produksi.
Headless contract tests juga mencakup clarification, paused tanpa grant, reconnect socket, mixed
usage, provider failure, tool error dan write timeout setelah side effect. Tidak ada benchmark
V4/Hermes, desktop feature, live model availability atau production deployment yang dibuktikan.
