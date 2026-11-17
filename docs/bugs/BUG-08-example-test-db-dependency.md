# BUG-08: Script Contoh `example:headless` Rusak Karena Coupling ke Test DB

## 1. Ringkasan Masalah

Pada file `package.json` (baris 17):
```json
"example:headless": "node --import tsx examples/fixture-demo.ts"
```

Ketika script ini dijalankan:
```text
npm run example:headless
```
Proses langsung berhenti dengan pesan error fatal:
```text
D:\Development\App\viper-engine\src\bootstrap\database-config.ts:17
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
Error: VIPER_TEST_DB_HOST is required
    at testServerConfig (tests/integration/postgres/database.ts:18:18)
    at createDatabase (tests/integration/postgres/database.ts:44:18)
    at headlessFixture (tests/support/client/headless-fixture.ts:27:20)
    at examples/fixture-demo.ts:6:23
```

## 2. Analisis Masalah

1. Script publik dalam folder `examples/` (`examples/fixture-demo.ts`) mengimpor langsung file internal pengujian integrasi (`tests/support/client/headless-fixture.js` dan `tests/integration/postgres/engine-fixtures.js`).
2. Script tersebut tidak menyertakan argumen `--env-file-if-exists=.env`, sehingga tidak membaca environment lokal secara otomatis.
3. Contoh penggunaan publik (*demo example*) seharusnya mendemonstrasikan cara menggunakan engine via antarmuka publik atau in-memory mock, bukan bergantung pada infrastruktur pembuatan database sementara pengujian integrasi (`VIPER_TEST_DB_*`).

## 3. Solusi & Rekomendasi

1. Modifikasi `examples/fixture-demo.ts` agar berjalan di atas database in-memory stub atau menggunakan konfigurasi PostgreSQL standar (`VIPER_DB_*`) alih-alih test runner database (`VIPER_TEST_DB_*`).
2. Tambahkan `--env-file-if-exists=.env` pada script `package.json` untuk `example:headless`.
