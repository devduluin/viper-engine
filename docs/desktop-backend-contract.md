# Future desktop extension note - DEFERRED

Revision R2. Viper Desktop masih rencana produk. Dokumen ini bukan implementation contract,
phase dependency, reading prerequisite atau release gate untuk Viper Engine sekarang.
Spesifikasi companion/endpoints yang rinci dari R1 ditarik dari scope aktif.

## Yang dijaga pada engine sekarang

- Core tidak mengimpor Next.js, Electron, Tauri atau UI state.
- Model/MCP/persistence/execution boundaries berupa ports yang dapat diganti/ditambah.
- Versioned HTTP API/events menggunakan explicit conversation/run/call identities.
- Durable state, cancellation, idempotency dan reconnect tidak bergantung lifecycle UI.
- HTTP/worker dapat dipisah proses jika perlu scaling; bounded buffers/concurrency.
- Secrets dan absolute filesystem paths bukan data bebas yang dipertukarkan ke client.

Semua ini adalah kebutuhan engine yang juga membantu client desktop di masa depan.
Kontrak aktif berada di [API contract](api-contract.md), bukan dokumen desktop ini.

## Yang tidak dibuat sekarang

Tidak ada desktop app, SDK khusus desktop, pairing, device/workspace tables, companion
WebSocket, local command ledger, terminal/browser/file executor, offline engine packaging,
atau hosted-local data synchronization. Tidak perlu placeholder DeviceGateway atau device IDs
pada setiap engine entity untuk mengantisipasi semua kemungkinan.

## Ketika desktop benar-benar dimulai

Tentukan apakah desktop hanya client hosted engine, memakai local companion untuk tools,
atau menjalankan local engine. Perlu scope tersendiri untuk identity/pairing, local storage,
permissions, artifacts, command outcome reconciliation dan supported operating systems.

MCP stdio sekarang berjalan di mesin backend. Untuk mengeksekusi server MCP di laptop
pengguna dibutuhkan execution path lokal yang dirancang pada phase desktop nanti.
Tidak menganggap backend hosted mempunyai akses filesystem/stdio laptop secara otomatis.

[Engine architecture](architecture.md) dan [API contract](api-contract.md) menjaga extension seams.
Tidak ada task desktop aktif di development plan R2 dan tidak ada desktop test gate sekarang.
