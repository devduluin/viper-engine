# Engine extensions plan: prompt caching, time anchor, tool catalog

Status: PLAN (Claude, 17 November 2026). Bukan bagian dari DAG P00–P08 dan tidak mengubah checklist.
Sumber: review usulan Gemini (`v4-feature-porting-plan*.md`). Dipilih tiga hal yang buktinya ada di repo ini;
yang lain ditunda (lihat [Tidak termasuk](#tidak-termasuk)).

Pembaca: agen dan developer yang mengerjakan engine (GPT/Codex, Claude, Gemini).

## Prinsip

1. **Ukur dulu, baru ubah.** Setiap fitur punya baseline dan pengukuran sesudah, dengan manifest yang
   dipin (`docs/integration/workin-live-*`). Angka dari luar repo (mis. "hemat 80%") tidak dipakai.
2. **Default off sampai terbukti.** Fitur yang mengubah prompt baru menyala default setelah eval live
   berpasangan menunjukkan tidak ada regresi kualitas, seperti P07-04.
3. **Provider-neutral di engine, spesifik di adapter.** Kontrak engine tidak tahu `cache_control` atau
   tool search. Itu urusan `src/adapters/models/{anthropic,openai}`.
4. **Tidak melonggarkan otorisasi.** Caching, header waktu, dan katalog tool tidak menambah tool, grant,
   atau approval. Policy dan approval tetap berlaku per call.

## Fakta awal (diverifikasi 17 November 2026)

| Area | Kondisi sekarang | Lokasi |
| --- | --- | --- |
| Caching | Tidak ada `cache_control` di request. System digabung jadi satu string. | `anthropic/to-request.ts` `toAnthropicParams` |
| Usage | Cache read/write dijumlahkan ke `inputTokens`, jadi hit cache tidak terlihat. | `anthropic/from-response.ts` `usageFrom`; `model_calls` hanya `input_tokens` |
| Urutan tool | Mengikuti urutan connection dan halaman discovery, tidak di-sort. | `bootstrap/mcp-tools.ts` |
| Evidence | Recall/plan dirakit **sebelum** history: `instructions → evidence → history`. | `agent/context/assemble.ts:41` |
| Waktu | Engine tidak memberi waktu sekarang. Host menaruh tanggal di instruksi statis per run. | runner `HOST_INSTRUCTION` |
| Katalog | Semua tool dari semua connection dikirim di setiap call (batas `maxTools` 1024). Workin: 13 tool, sekitar 15k token input per call. | `engine-config.ts`, report workin-live |

Referensi API: dokumentasi Anthropic prompt caching dan tool search (render order `tools → system →
messages`, maksimal 4 breakpoint, minimum 512 token prefix untuk Opus 5.5/Sonnet 5.5, read 0,05×,
write 1,25× untuk TTL 5 menit).

## Status (17 November 2026)

| Task | Status | Bukti |
| --- | --- | --- |
| X01 | **DONE** (Claude) | Detail di bawah |
| X04 | **DONE** (Claude) | Detail di bawah |
| X02, X03, X05, X06 | Belum mulai | X02 adalah langkah berikutnya |

**X01**

- `ModelUsage.cacheReadTokens/cacheWriteTokens` opsional; `inputTokens` tetap total.
- Mapping Anthropic dan OpenAI (`cached_tokens`).
- Migration `0013_model_call_cache_usage.sql`, dengan constraint cache ≤ input dan null untuk usage `unavailable`.
- Runner menulis `cacheRead`, `cacheWrite`, `effectiveInput`, dan `cacheFactors`.
- Test: unit `model-usage`, contract kedua adapter, integration `model-call-cache-usage`.

**X04**

- `sortByAlias` (urutan code-point) di `discoverRuntimeTools`, dengan unit test `tool-order`.
- Manifest workin-live mencatat `schemaBytes` dan `catalogTokens` dari token counter provider.

Gate: unit 294, contract 153, integration 177/177; typecheck/lint/architecture bersih untuk file ini.

**Baseline terukur** (`artifacts/evals/workin-live-2026-11-17T16-05-46-756Z/report.json`, Opus 5.5):

- Cache read/write **0** di setiap call. Caching memang belum aktif, dan kini terbukti.
- Katalog 13 tool = 14 059 byte = **6 926 token**, sekitar 46% input per call WL-001 (≈ 7 470 token per call).
  Bagian ini identik antar call dan menjadi target utama X02.

## X01: Usage cache yang terukur (prasyarat X02–X06)

Masalah: tanpa pemisahan read/write, caching tidak bisa dibuktikan atau dipantau regresinya.

- `ModelUsage` mendapat field opsional `cacheReadTokens` dan `cacheWriteTokens`.
  `inputTokens` tetap total (kompatibel dengan API publik dan budget).
- Anthropic: dari `cache_read_input_tokens` / `cache_creation_input_tokens`. OpenAI: dari
  `prompt_tokens_details.cached_tokens` (write tidak dilaporkan, jadi `null`).
- Migration baru `model_calls.cache_read_tokens` / `cache_write_tokens` (nullable, ≥ 0). Migration lama
  tidak diubah.
- Runner workin-live mencatat keduanya per run dan menghitung **effective input** =
  uncached + 1,25 × write + 0,05 × read (Opus 5.5, TTL 5 menit). Faktornya dicatat di manifest.

Acceptance: contract test untuk kedua adapter, integration test untuk kolom baru, dan report workin-live
menampilkan cache read/write. Tanpa perubahan perilaku request.

## X02: Prompt caching Anthropic

Desain mengikuti pola "agent loop" di dokumentasi:

1. **Prefix stabil.** System dikirim sebagai array blok, bukan string gabungan. Tool di-sort
   deterministik berdasarkan alias (lihat X04). Tidak ada nilai per-request (waktu, UUID) di system
   atau tools. Waktu masuk lewat X03, di dalam messages.
2. **Breakpoint eksplisit** di blok system terakhir: menyimpan tools + system yang mahal dan sama
   untuk semua call dalam run maupun antar run dengan konfigurasi sama.
3. **Caching otomatis tingkat atas** untuk ekor percakapan yang tumbuh (history, tool_result).
4. TTL default 5 menit (jarak antar call dalam loop jauh di bawah 5 menit). Opsi `ttl: '1h'` hanya bila
   pengukuran chat dengan jeda panjang menunjukkan untung.
5. Setting adapter `promptCache: 'off' | 'on'` (default **off** sampai acceptance), dengan TTL opsional.

Risiko yang harus diukur, bukan diasumsikan:

- **Evidence sebelum history.** Bila recall/plan berubah antar call, cache history batal dari titik itu.
  Kalau pengukuran menunjukkan `cache_write` hampir sebesar seluruh prompt di setiap call, usulkan
  pemindahan evidence ke owner P07-02 sebagai keputusan terpisah.
- **Thinking binding** (`drop_block`): blok thinking yang dibuang mengubah messages cache dari titik itu.
  Laporkan bila muncul.
- Prefix di bawah minimum (512 token) tidak di-cache. Itu wajar, bukan bug.

Pengukuran (workin-live, Opus 5.5, manifest identik, 3 trial):

- Varian `cache-off` vs `cache-on` untuk 40 case.
- Metrik: pass rate (tidak boleh turun), cache read/write per call, effective input, detik per run, dan
  time-to-first-token bila adapter mencatatnya.
- Regression guard: integration test FakeAnthropic yang memastikan breakpoint ada di blok system terakhir
  dan dua request berurutan dalam satu run byte-identik pada bagian prefix (diff tanpa `cache_control`).

Acceptance: tidak ada regresi pass rate; call kedua dan seterusnya dalam satu run punya `cache_read > 0`;
penghematan effective input dilaporkan apa adanya. Setelah itu default diubah ke `on` lewat keputusan
tercatat. OpenAI: hanya X04 (urutan stabil) dan X01 (pencatatan), karena caching-nya otomatis.

## X03: Time anchor per run

Masalah: tanggal sekarang hanya ada bila host menulisnya di instruksi. Instruksi statis bisa basi di
percakapan panjang, dan menaruh waktu di system prompt akan membatalkan cache (X02).

Desain:

- Opsi engine `timeContext?: { timeZone: string | ((scope) => Promise<string>) }`, default **off**.
  Zona waktu per tenant didukung (WIB/WITA/WIT lewat IANA, mis. `Asia/Jakarta`, `Asia/Makassar`).
- Saat run mulai, engine menyimpan `startedAt` (Clock yang diinjeksi) dan zona waktu yang terselesaikan
  ke checkpoint run. Nilainya immutable per run.
- Saat merakit request, engine merender **satu blok anchor per run**, tepat setelah pesan input run itu,
  dari nilai yang tersimpan. Contoh: `Current time when this request was made: 2026-11-17T20:50+07:00
  (Tuesday), time zone Asia/Jakarta.` Format ISO dan bahasa netral; bahasa jawaban tetap dari instruksi host.
- Karena dirender dari nilai tersimpan, bytes-nya sama di setiap call berikutnya, sehingga cache aman.
  Blok ini tidak masuk canonical history, event, atau API publik.
- Kanal: `role: "system"` mid-conversation di Anthropic (Opus 5.5/Sonnet 5.5 tanpa beta; kanal operator
  yang tidak bisa dipalsukan user). Fallback untuk model tanpa dukungan (error 400 → simpan kapabilitas
  per model) adalah blok teks pada pesan user. OpenAI: pesan system/developer setelah pesan user.
- Batas: anchor adalah waktu **mulai run**. Run yang melewati tengah malam tetap memakai anchor awal.
  Ini didokumentasikan; tool waktu tidak ditambahkan.

Tidak dilakukan: port parser bahasa Indonesia V4 (562 baris). 40 case Workin menunjukkan model sudah
benar menghitung tanggal bila diberi tanggal hari ini.

Pengukuran:

- Runner memakai Clock yang dipin (mis. `2026-11-17T09:00+07:00`) sehingga hasilnya deterministik.
- Tambah sekitar 6 case relatif ("kemarin", "Senin lalu", "minggu depan", "awal bulan ini", "3 hari lagi",
  "besok") yang dijawab dengan tool berparameter tanggal eksplisit. `get_today_summary` dihindari karena
  memakai tanggal server sungguhan.
- Varian: (a) host tanpa tanggal + anchor off, (b) host tanpa tanggal + anchor on, (c) host dengan
  tanggal (praktik sekarang).
- Harapan: b ≫ a, b ≈ c. Cache read pada b tidak lebih rendah dari varian tanpa anchor.

Acceptance: unit test format dan zona waktu (termasuk WITA/WIT), test determinisme bytes antar call,
dan integration test bahwa anchor tidak masuk history atau API. Eval di atas dilaporkan.

## X04: Katalog tool, pengukuran dan urutan stabil

- Sort tool berdasarkan alias sebelum dikirim ke adapter, supaya prefix cache stabil walau urutan
  connection atau halaman berubah.
- Statistik katalog per run: jumlah tool, byte skema, dan estimasi token. Untuk Anthropic, ukur dengan
  endpoint token counting pada request yang hanya berisi tools. Catat di manifest workin-live,
  berikut porsi katalog terhadap input.
- Acceptance: unit test urutan, dan report yang menunjukkan berapa persen input per call adalah katalog.

## X05: Stress eval katalog besar

Tujuan: mencari titik di mana jumlah tool mulai merusak akurasi atau biaya, **sebelum** service HRIS
lain dan Margin masuk.

- Fixture MCP server "distractor" read-only dengan N tool HR yang masuk akal tapi tidak relevan
  (deterministik, di `tests/support` atau `docs/integration`), dipasang sebagai connection tambahan di
  runner.
- N = 0, 25, 50, 100, 200. Untuk tiap N: pass rate, akurasi pemilihan tool (aturan `toolsAll`/`toolsAny`
  dataset), token input, cache read, dan detik.
- Output: kurva yang menentukan ambang aktivasi X06. Tidak ada perubahan engine.

## X06: Strategi skala katalog (desain final setelah data X05)

Berlapis, dari yang paling murah:

1. **Batasi scope dulu (tanpa kode engine).** Host `connections(scope, checkpoint)` hanya mengembalikan
   connection produk yang relevan (Workin vs Margin). Gateway sudah memfilter per account type.
   Didokumentasikan sebagai praktik wajib.
2. **Core vs deferred.** Host menandai tool inti (selalu dimuat) dan tool deferred. Penandaannya lewat
   konfigurasi host, opsional dengan hint `_meta` dari service (mis. `duluin/core`). Tool deferred tetap
   ada di katalog yang sudah diotorisasi; tidak ada tool baru yang lolos policy.
3. **Discovery.**
   - Anthropic: server-side tool search dengan `defer_loading`. Skema yang ditemukan ditambahkan, bukan
     ditukar, sehingga cache aman.
   - Provider-neutral (OpenAI): tool bawaan engine dengan namespace yang dicadangkan
     (`viper__search_tools`). Tool ini mencari nama dan deskripsi di katalog run, lalu mengaktifkan tool
     terpilih untuk sisa run.
   - Keduanya hanya bisa memunculkan tool dari katalog yang sudah diotorisasi untuk scope tersebut.

Acceptance (pada N dari X05 yang menunjukkan degradasi):

- pass rate kembali ke baseline 13 tool (selisih ≤ 1 case per 40);
- token input per call turun;
- 40 case Workin tanpa distractor tidak regresi;
- approval/policy test tetap lulus.

## Urutan dan dependensi

| Urutan | Task | Bergantung pada | Catatan paralel |
| --- | --- | --- | --- |
| 1 | X01 usage cache | — | Kecil. Migration baru; koordinasi dengan owner persistence. |
| 2 | X04 urutan dan statistik katalog | — | Bisa paralel dengan X01. |
| 3 | X02 prompt caching | X01, X04 | Adapter Anthropic. Sebaiknya sebelum P08-02/P08-04, supaya pengukuran rilis memakai engine final. |
| 4 | X03 time anchor | X02 (agar posisinya cache-safe) | Butuh dukungan system mid-conversation di adapter. |
| 5 | X05 stress eval | X01, X04 | Hanya eval, tanpa perubahan engine. |
| 6 | X06 strategi katalog | X05 | Lapis 1 (scope) bisa didokumentasikan kapan saja. |

Biaya eval live (perkiraan, Opus 5.5):

- X02: 40 case × 3 trial × 2 varian;
- X03: sekitar 6 case × 3 trial × 3 varian;
- X05: sekitar 10 case × 5 nilai N × 2 trial.

Setiap run live butuh persetujuan user, dan data dummy di-reset sebelumnya.

## Tidak termasuk

| Usulan | Keputusan | Alasan |
| --- | --- | --- |
| User profile & fact tables | Tolak | Duplikat P07-02 (recall/notes) dan P07-03 (proposal dengan review). |
| Trajectory playbook otomatis | Tolak untuk sekarang | Ablation live P07-04: checklist tidak menaikkan kualitas, +10–27% token. P07-03 melarang promosi otomatis. |
| Subagent delegation | Tunda | Backlog eksplisit di development plan; butuh scope tersendiri. |
| Code sandbox | Tunda, di luar engine | Tidak ada use case Workin. VM2 sudah dihentikan dan punya celah kritis; kalau dibutuhkan, pakai container atau sandbox terkelola sebagai MCP terpisah. |
| File/artifact export | Nanti, di luar engine | Relevan untuk ekspor rekap, tapi sebagai MCP server tersendiri. Engine hanya meneruskan resource link. |
| Web search, RAG, OAuth, scheduler | Nanti | MCP eksternal atau tanggung jawab host; menunggu kebutuhan produk. |
| Parser waktu bahasa Indonesia (V4) | Tolak | Diganti X03; belum ada bukti model salah hitung tanggal. |
