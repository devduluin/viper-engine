# MCP-first agent design

Revision R2. Ini desain implementasi, belum runtime yang berjalan.

## Prinsip dari Hermes yang diadopsi

Hermes mendokumentasikan siklus context/messages -> model -> tool calls -> tool results -> model,
dengan penyimpanan percakapan, context management, provider boundary dan budgets. Viper mengadopsi
pola itu melalui komponen TypeScript; struktur Python dan seluruh fitur Hermes tidak disalin.
[Hermes agent loop](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md),
[Hermes architecture](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md).

Tidak ada kewajiban melewati vector intent matching, adjudicator, atau decomposition sebelum
model dapat bekerja. Model menerima tujuan, history yang relevan dan daftar capability MCP
yang tersedia. Runtime mengatur validation/policy/budget/execution; model memilih langkah.

## Terminologi

MCP mendefinisikan tools, resources dan prompts sebagai kemampuan protokol. Tools adalah
functions yang dapat dipanggil model; resources menyediakan data; prompts adalah template
yang dipilih pengguna/aplikasi sesuai protokol. Ini tidak sama dengan tiga kategori bisnis
tools/knowledges/skill dalam Viper lama.
[MCP server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)

Tidak membangun ulang custom knowledge registry, executable skill registry, atau intent DB.
Jika nanti ada procedural instructions mirip Hermes skills, perlakukan sebagai context/playbook
opsional yang versioned. Tidak perlu handler executable baru atau tabel taxonomy sejak awal.

## Discovery dan model exposure

1. Resolve trusted scope dan active connection.
2. Connect/initialize MCP sesuai protocol/SDK version yang dipin saat implementasi.
3. Discover advertised tools; tangani pagination dan list changes bila didukung.
4. Normalize schemas dan buat stable namespaced model tool IDs.
5. Filter berdasarkan availability dan akses sebelum memasukkan schema ke model context.
6. Saat dipanggil, resolve ID kembali ke connection/server/tool dan recheck akses/version.

Definition metadata milik server adalah input untuk model/policy, bukan izin independen.
Tool descriptions tidak boleh mengubah identity, scope, approval rules atau runtime budget.
Large catalog dapat memakai on-demand discovery/filtering; vector service bukan prasyarat.

## Tool calling

Model mengusulkan tool call dengan ID dan args. Runtime memvalidasi schema dan readiness,
menerapkan action policy, mencatat dispatch intent, lalu memanggil MCP adapter. Hasil dinormalisasi
menjadi content blocks/structured output/error/unknown dan masuk ke history dengan tool-call ID.

Read-only calls independen dapat dijalankan paralel dengan batas. Calls berurutan/dependen atau
side effects tidak otomatis diparalelkan. MCP annotations dipertimbangkan bersama policy konfigurasi,
bukan satu-satunya bukti bahwa operasi aman.

Missing/ambiguous args menghasilkan bounded clarification, bukan tebakan identifier. Remote
write timeout atau process crash dapat berarti outcome unknown; hentikan retry otomatis dan
rekonsiliasi. Approval selalu mengikat final args dan schema/connection version.

## Resources dan prompts

Resources/list/read dan prompts/list/get tersedia bila server mengiklankannya dan deployment
mengizinkannya. P05 menguji keduanya secara eksplisit, termasuk kasus unsupported.

Resources masuk ke context melalui application-controlled read, menggunakan server connection
yang sudah diotorisasi. Jika diekspos sebagai engine helper action untuk model, bridge itu eksplisit,
terbatas pada discovered references dan tetap menjalankan policy/budget. Jangan fetch arbitrary URI
dari untrusted output melalui HTTP client umum sebagai pengganti MCP resource read.

Prompts dipilih lewat user/application request lalu dimuat lewat MCP. Jangan otomatis menjadikan
semua prompt template sebagai system instruction. Tidak menyatukan resource/prompt menjadi tool
eksekusi tanpa kontrak bridge yang jelas. Konten provider tetap tidak dapat memberi izin baru.

## Transport dan lifecycle

Implement Streamable HTTP dan stdio sesuai kebutuhan connector. Stdio berjalan di mesin
backend yang menjalankan subprocess, bukan otomatis di laptop pengguna. Legacy SSE hanya
ditambahkan jika ada server nyata yang memerlukannya. Credentials di-resolve melalui port.

Per-user OAuth/refresh/revoke dipisahkan dari catalog definition. Tidak ada fallback otomatis
ke akun development atau koneksi pengguna lain. Proses/HTTP sessions memiliki cleanup dan timeout;
timeout tidak dianggap pembatalan efek samping remote.

Advanced MCP features seperti sampling/elicitation tidak otomatis diaktifkan. Negosiasikan
capabilities, implement policy/tests terlebih dahulu; unsupported ditangani secara eksplisit.

## Minimum end-to-end acceptance

- Satu koneksi -> tools discovery -> model tool call -> MCP result -> jawaban dengan evidence.
- Dua calls berantai memakai result sebelumnya dan pairing IDs yang benar.
- Server dengan resources/prompts didukung; server tools-only tidak dianggap rusak.
- Invalid args, `isError`, transport failure, auth expiry dan disconnected server ditangani berbeda.
- Revoke/private access berlaku saat discovery dan dispatch, termasuk resume.
- Tidak ada import schema/registry atau handler categories milik Viper lama.
