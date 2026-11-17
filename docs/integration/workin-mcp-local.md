# Menjalankan MCP Workin (HR attendance) secara lokal untuk Viper Engine

Catatan integrasi, terakhir diperbarui 17 November 2026. Tujuannya menguji Viper Engine (P05 MCP
adapter) terhadap server MCP nyata: `service_attendance` di belakang `gateway_v3`, dengan login
SSO sungguhan.

## Arsitektur

```text
workspace.duluin (login) → cookie app_token (token SSO bersama ekosistem Duluin)
viper-ui → Viper Engine (connectMcp, Streamable HTTP, Authorization: Bearer <token SSO>)
  → gateway_v3  /api/v2/mcp     tugas: collect tool, validasi token ke SSO, proxy
       → SSO  GET /api/users/signin-cookies (X-Account-Type: launchpad_workspace)
  → service_attendance  /api/v2/mcp   menerima token SSO yang sama dari gateway
       → SSO signin-cookies sendiri → akun user → grup tool = folder tools/<account_type>/
       → MySQL db_attendance; service_employees untuk data karyawan
```

Gateway hanya proxy: tidak memilih tenant, tidak memeriksa account type, dan tidak memeriksa
role. Service yang memutuskan:

| Akun user | Hasil di attendance MCP |
| --- | --- |
| punya `hris_company` | tool di `tools/hris_company/` diizinkan; `auth.accountId` = `company_id` |
| tidak punya `hris_company` (misalnya hanya `hris_employee`) | `ACCOUNT_TYPE_REQUIRED` |
| tanpa token | hanya `initialize` / `tools/list` (untuk discovery gateway) |

Detail kontrak: `gateway_v3/mcp/README.md`.

## Tool yang diekspos `service_attendance`

| Tool | Butuh `service_employees`? | Catatan |
| --- | --- | --- |
| `hris_attendance_ping` | Tidak | Paling aman untuk smoke test |
| `hris_attendance_list_shift_types` | Tidak | |
| `hris_attendance_get_today_summary` | Ya | |
| `hris_attendance_search_daily` | Ya | |
| `hris_attendance_get_period_summary` | Ya | |
| `hris_attendance_search_requests` | Ya | |
| `hris_attendance_get_schedule` | Ya | |
| `hris_attendance_search_schedule` | Ya | |
| `hris_attendance_create_schedule` | Ya | **Write**: di Viper wajib lewat approval |

Ada juga resource panduan (`workin-guides`), misalnya "Cara Import Shift".

## Langkah menjalankan (lokal, dev)

Tidak ada env MCP baru. Yang dipakai hanya env yang sudah ada di masing-masing proyek.

| Komponen | Port contoh | Env yang relevan (sudah ada) |
| --- | --- | --- |
| SSO (`D:\Development\App\sso`, branch `staging` terbaru) | 8010 | `.env` lokal, DB `db_sso` |
| workspace.duluin | 3003 | `NEXT_PUBLIC_AUTH_API_URL=http://127.0.0.1:8010/api` |
| gateway_v3 | 9996 | `SSO_AUTH_API_URL=http://127.0.0.1:8010/api`; URL attendance di `mcp/config/mcp-services.json` (bukan env) |
| service_attendance | 4446 | `NODE_ENV=development`, `PORT=4446`, `SSO_API_URL=http://127.0.0.1:8010` |

1. **SSO:** `git pull` di branch `staging`, `composer install`, `php artisan migrate` (DB dev
   lokal), lalu `php artisan serve --host=127.0.0.1 --port=8010`. Kode SSO lama (sebelum scope
   dinamis) menolak login workspace dengan "The requested scope is invalid".
2. **workspace:** `NEXT_PUBLIC_AUTH_API_URL=http://127.0.0.1:8010/api npx next dev --turbopack -p 3003`,
   lalu login. Token ada di cookie `app_token`.
3. **attendance:** `SSO_API_URL=http://127.0.0.1:8010 node app.js` (config DB `development` →
   MySQL lokal `db_attendance`).
4. **gateway:** `SSO_AUTH_API_URL=http://127.0.0.1:8010/api node app.js`. Discovery harus
   mencatat `attendance (workin): 9 tools`.

Akun uji harus punya `hris_company` yang `secondary_id`-nya ada di `db_attendance`. Untuk uji
17 November, `db_sso` lokal ditambah satu baris `user_accounts` (id
`110792bb-ee3a-4883-b5ee-5d570ee6c3c4`): user dev → `hris_company` = `c8f745e0-aa6e-458b-bb70-4dda3e2accea`.
Hapus baris itu bila tidak diperlukan lagi.

## Uji dari Viper Engine

```ts
const owner = { scope, connection: { id: 'workin-local', serverId: 'gateway-v3' } };
const mcp = await connectMcp(owner, {
  kind: 'streamable_http',
  url: 'http://127.0.0.1:9996/api/v2/mcp',
  headers: { Authorization: `Bearer ${ssoToken}` },        // hanya header standar
}, { clock, connectTimeoutMs: 15_000, requestTimeoutMs: 30_000 });
const tools = await mcp.catalog.all();                    // 9 tool Workin
```

Produksi: `McpCredentialPort` mengembalikan `{ kind: 'bearer', token: <token SSO user> }`.

Hasil uji 17 November 2026 (SSO lokal, token asli dari login workspace):

- tanpa akun `hris_company`: 9 tool terlihat, tool ditolak (kode saat itu `COMPANY_CONTEXT_REQUIRED`, kini `ACCOUNT_TYPE_REQUIRED`);
- dengan `hris_company`, tanpa role apa pun: `ping` dan `list_shift_types` sukses, dan
  attendance mencatat `Company: c8f745e0…` yang dibaca sendiri dari SSO.

Skenario berikutnya: rantai `search_schedule` → `get_schedule` dengan `service_employees` berjalan,
dan `create_schedule` sebagai write yang wajib lewat approval.

## Perubahan di repo lain (belum di-commit)

**service_attendance** (`staging`)

| Perubahan | Alasan |
| --- | --- |
| `Op.iLike` → `Op.like` (8 tempat) | `ILIKE` adalah syntax error di MySQL; collation `*_ci` sudah case-insensitive |
| Sesi MCP dibatasi (30 menit idle, maks 1000), terikat ke identitas, ada route `DELETE` | Sesi sebelumnya menumpuk tanpa batas dan bisa dipakai konteks lain |
| Identitas MCP dari token SSO user (`mcp/auth/sso-identity.js` + salinan mandiri `mcp/auth/sso-profile.js`) | Header `X-Company-Id` dulu bisa dipalsukan; kini tenant dibaca sendiri dari SSO |
| Izin MCP = folder tool `tools/<account_type>/` (sekarang `tools/hris_company/`); tanpa akun itu → `ACCOUNT_TYPE_REQUIRED`; role belum dipakai (`MCP_ADMIN_ROLES` tidak lagi dibaca) | Nama role HRIS berbeda per company, jadi tidak bisa dicocokkan dengan `admin` |
| Tes `tests/mcpSession.test.js` (4 tes) | Suite penuh 563 tes; 8 kegagalan yang sama sudah ada di `HEAD` |

**gateway_v3** (`staging`)

| Perubahan | Alasan |
| --- | --- |
| Modul MCP di `mcp/` dengan subfolder; registry `mcp/config/mcp-services.json` | Tidak lagi HRIS-centric; produk baru cukup didaftarkan |
| Hanya collect, validasi token, proxy; token SSO diteruskan, tanpa role/tenant | Keputusan akun dan role milik service |
| Standar MCP: 404 sesi kedaluwarsa, cek `Origin` tanpa konfigurasi, `-32602`/`-32002`, `listChanged`, cancel/progress diteruskan, `timeoutMs` per service, 401 + metadata RFC 9728 | Agar client MCP mana pun berperilaku benar |
| `OUTCOME_UNKNOWN` untuk call terkirim tanpa jawaban; `SERVICE_UNAVAILABLE` bila belum terkirim | Write yang timeout tidak boleh dianggap gagal lalu diulang |
| Tes gateway 41/41 | |

**Kecocokan dengan Viper:** `OUTCOME_UNKNOWN` dipetakan adapter P05 menjadi `unknown` (tidak
di-retry otomatis); `-32602` menjadi penolakan server (tool tidak dipanggil).

## Risiko dan tindak lanjut

1. **Viper:** pool koneksi perlu `initialize` ulang saat gateway menjawab 404 (sesi kedaluwarsa);
   `-32002` dari `resources/read` sebaiknya dipetakan ke `not_found`.
2. **Agent pihak ketiga (ChatGPT/Claude connector):** SSO belum menjadi OAuth authorization server.
3. **Role/permission per service:** belum ada; attendance hanya memeriksa grup akun.
4. **`service_attendance/.env.example`** tidak memuat `SSO_API_URL`, padahal kode memakainya.
5. **Nilai mirip secret di `.env.example` attendance** (ter-commit) sebaiknya diganti placeholder
   dan di-rotate.
6. **Kebijakan Viper:** `db_attendance` dan `db_sso` dev dipakai atas izin pemilik untuk uji lokal;
   jangan arahkan ke DB produksi atau V4.
