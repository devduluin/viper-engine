# Pengujian MCP Workin (real, lokal)

Runbook untuk menguji Viper Engine terhadap MCP Workin sungguhan: login SSO asli → Viper →
`gateway_v3` → `service_attendance` (9 tool) dan `service_employees` (4 tool) → `db_attendance` /
`db_employees`. Arsitektur dan riwayat perubahan ada di
`workin-mcp-local.md`; dokumen ini hanya langkah uji yang bisa diulang.

Terakhir dijalankan: 17 November 2026 (hasil per skenario di bagian 5). Kode yang diuji:
`gateway_v3` staging `8b5867b`, `service_attendance` staging `fe5cd28`, `service_employees` staging
`2c6498a`, `sso` staging `60365820`.

## 1. Prasyarat (sekali)

| Komponen | Lokasi | Catatan |
| --- | --- | --- |
| SSO | `D:\Development\App\sso` | branch `staging` terbaru; `composer install`; `php artisan migrate` ke `db_sso` dev |
| workspace.duluin | `D:\Development\App\workspace.duluin` | dipakai hanya untuk login |
| gateway_v3 | `D:\Development\App\gateway_v3` | registry `mcp/config/mcp-services.json` (`workin` → attendance `http://localhost:4446`) |
| service_attendance | `D:\Development\App\service_attendance` | config DB `development` → MySQL lokal `db_attendance` |
| service_employees | `D:\Development\App\service_employees` | config DB `development` → `db_employees`; MCP di `mcp/` (4 tool `hris_employees_*`) |
| MySQL (laragon) | `127.0.0.1:3306` | `db_sso` dan `db_attendance` dev |

Akun uji harus punya akun SSO **`hris_company`** aktif yang `secondary_id`-nya adalah company di
`db_attendance`. Untuk user dev saat ini sudah ada baris `user_accounts`
`110792bb-ee3a-4883-b5ee-5d570ee6c3c4` (→ company `c8f745e0-aa6e-458b-bb70-4dda3e2accea`, yang punya
data shift). Untuk user lain, tambahkan lewat tinker di folder SSO (DB dev saja):

```php
// php artisan tinker
$hris = DB::table('accounts')->where('account', 'hris_company')->value('id');
DB::table('user_accounts')->insert(['id' => (string) Str::uuid(), 'user_id' => '<user id>', 'account_id' => $hris,
  'secondary_id' => '<company_id di db_attendance>', 'is_activated' => 1, 'is_banned' => 0, 'is_subdomain' => 0,
  'activated_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
```

## 2. Menjalankan (5 terminal)

Semua memakai env yang sudah ada; tidak ada env MCP baru.

```bash
# 1) SSO (port 8010)
cd D:/Development/App/sso && php artisan serve --host=127.0.0.1 --port=8010

# 2) workspace untuk login (port 3003), diarahkan ke SSO lokal
cd D:/Development/App/workspace.duluin && NEXT_PUBLIC_AUTH_API_URL=http://127.0.0.1:8010/api npx next dev --turbopack -p 3003

# 3) employees (port 5555)
cd D:/Development/App/service_employees && NODE_ENV=development PORT=5555 SSO_API_URL=http://127.0.0.1:8010 node app.js

# 4) attendance (port 4446), memakai employees lokal untuk data karyawan
cd D:/Development/App/service_attendance && NODE_ENV=development PORT=4446 SSO_API_URL=http://127.0.0.1:8010 EMPLOYEE_API_URL=http://127.0.0.1:5555 node app.js

# 5) gateway (port 9996)
cd D:/Development/App/gateway_v3 && SSO_AUTH_API_URL=http://127.0.0.1:8010/api node app.js
```

Jalankan employees dan attendance **sebelum** gateway agar discovery pertama langsung berhasil.
Log gateway harus memuat:
`[MCP Discovery] attendance (workin): 9 tools, 1 resources discovered.` dan
`[MCP Discovery] employees (workin): 4 tools, 0 resources discovered.`

Catatan employees: `npm install` di repo itu menjalankan migrasi otomatis (skrip `prepare`); pakai
`npm install --ignore-scripts`. Migration `20260608120000-add-interview-resume-to-interview-sessions`
rusak (tabel `interview_sessions` tidak pernah dibuat); di DB dev lokal ditandai sudah jalan.

## 3. Token

Login di `http://localhost:3003`. Token = cookie `app_token` (DevTools → Application → Cookies),
atau `result.token` dari respons login. Simpan di file lokal di luar repo, misalnya
`%TEMP%\workin-sso-token.txt`; jangan ditempel di chat atau di-commit.

## 4. Data dummy (dev, 10–21 November 2026)

Data asli `db_attendance` terakhir padat di Januari 2025, sedangkan "hari ini" kosong. Untuk uji
yang realistis, `workin-dummy-seed.cjs` (folder ini) mengisi company c8f745e0:

| Karyawan | Pola |
| --- | --- |
| Ardi Mahendra (D-0005) | tepat waktu; terlambat 25 menit 12 Nov; check-in 07:55 hari ini (17 Nov) |
| Abraham Gamaliel Figrana (D-0006) | terlambat 30–45 menit setiap hari |
| ACHMAD FATHONI (B-0360) | cuti 13–14 Nov |
| ACHMAD GHOFUR (B-0348) | tidak hadir 11 Nov; belum check-in hari ini |
| adas silalahi (TESTING) | WFH 12 Nov (pengajuan WFH disetujui) |
| AGUNG SETYO (B-0358) | belum check-in hari ini |
| Agus Setiawan (D-0013) | tepat waktu; pengajuan lembur 18 Nov (menunggu) |
| AHMAD QAYYIM (B-0432) | terlambat 16 menit hari ini; pengajuan tukar shift 19 Nov (menunggu) |

Semua memakai shift "Shift Pagi (dummy MCP)" 08:00–17:00, toleransi 15 menit, Senin–Jumat.
Isi: 1 tipe shift, 16 jadwal, 46 kehadiran, 3 pengajuan. Semua id tercatat di
`workin-dummy-manifest.json`; kehadiran juga bertanda `client_reference_id LIKE 'dummy-mcp:%'`.

```bash
cd D:/Development/App/service_attendance
NODE_ENV=development node ../viper-engine/docs/integration/workin-dummy-seed.cjs ../viper-engine/docs/integration/workin-dummy-employees.json ../viper-engine/docs/integration/workin-dummy-manifest.json   # isi
NODE_ENV=development node ../viper-engine/docs/integration/workin-dummy-seed.cjs --cleanup ../viper-engine/docs/integration/workin-dummy-manifest.json   # hapus
```

Profil karyawan (tanggal lahir dll.) memakai data asli `db_employees` (292 karyawan; banyak tanggal
lahir 1 Januari dari data import, jadi "ulang tahun Januari" berisi ±199 orang).

## 5. Cek cepat (curl)

```bash
G=http://127.0.0.1:9996
curl -s $G/.well-known/oauth-protected-resource/api/v2/mcp        # metadata: authorization_servers = SSO
curl -s -o /dev/null -w "%{http_code}\n" -X POST $G/api/v2/mcp     # 401 (tanpa token) + WWW-Authenticate
```

## 6. Skenario uji

| # | Skenario | Cara | Hasil yang diharapkan |
| --- | --- | --- | --- |
| T1 | Daftar tool | smoke script (bagian 6) | 9 tool, semua `_meta["duluin/accountType"] = "hris_company"` |
| T2 | Read sederhana | `hris_attendance_ping` | `success`; `content[0]` = ringkasan "Service attendance aktif…" |
| T3 | Read data | `hris_attendance_list_shift_types` `{ "search": "shift" }` | `success`; data shift company c8f745e0 |
| T4 | Tanpa akun `hris_company` | user lain, atau set `is_activated = 0` pada baris uji lalu tunggu cache 60 detik | `tools/list` kosong untuk tool hris_company; memanggilnya → `ACCOUNT_TYPE_REQUIRED` |
| T5 | Token tidak sah | ganti token dengan teks acak | `401` dari gateway, Viper: `authentication_required` |
| T6 | Attendance restart di tengah sesi | ping, restart attendance, ping lagi < 30 detik | ping kedua `success`; log gateway `attendance lost the session; reconnecting once` |
| T7 | Attendance mati | hentikan attendance, panggil ping | tool error `SERVICE_UNAVAILABLE … the tool was not called` (bukan `OUTCOME_UNKNOWN`) |
| T8 | Argumen di luar batas | `hris_attendance_search_daily` `{ "limit": 1000000 }` | `INVALID_PARAMETER` ("limit maksimal …"); tool tidak jalan |
| T9 | Rantai jadwal | `search_schedule` → `get_schedule` | butuh `service_employees` berjalan (`EMPLOYEE_API_URL`) |
| T10 | Write lewat approval | `hris_attendance_create_schedule` dari run Viper | Viper wajib meminta approval (annotation `readOnlyHint:false`); jalankan hanya di data dev |
| T11 | Dua service, satu koneksi | `tools/list` | 13 tool: 9 `hris_attendance_*` + 4 `hris_employees_*` |
| T12 | Profil karyawan | `hris_employees_get_profile` `{ "employee": "Ardi Mahendra" }` | ringkasan "lahir di Sinar Seputih pada 25 Januari 1991 (35 tahun)…" |
| T13 | Nama ambigu | `hris_employees_get_profile` `{ "employee": "Ardi" }` | `EMPLOYEE_AMBIGUOUS` + pilihan (Ardi Mahendra, Ardinas, Ardik, …) |
| T14 | Hari ini (dummy) | `hris_attendance_get_today_summary` | 8 terjadwal, 6 hadir, 2 belum check-in |
| T15 | Jadwal & pengajuan (dummy) | `get_schedule` Ardi 17–21 Nov; `search_requests` 1–30 Nov | Shift Pagi 08:00–17:00; 3 pengajuan (WFH approved, lembur & tukar shift submit) |
| T16 | Siapa terlambat (dummy) | `search_daily` `{ "date": "2026-11-12", "status": "late" }`; hari ini `{ "status": "late" }` | 12 Nov: 2 (Ardi 25 menit, Abraham); 17 Nov: 2 (Abraham, Ahmad Qayyim 16 menit); setiap karyawan hadir membawa `lateMinutes`/`late` |
| T17 | Ringkasan untuk AI | semua tool | `content[0]` = kalimat ringkasan (`meta.summary`), `content[1]` = JSON; `check.js` attendance & employees 0 warning |

17 November 2026: T1, T2, T3, T5, T6, T7, T8, T11–T17 lulus langsung (real). T4 lulus di tes otomatis
(penyaringan `tools/list` dan `ACCOUNT_TYPE_REQUIRED`); uji langsungnya baru dengan versi kode
sebelumnya, ulangi dengan user tanpa `hris_company`. T9–T10 belum dijalankan.

## 7. Smoke script (Viper adapter P05)

Simpan di luar repo, mis. `%TEMP%\workin-smoke.mts`, lalu jalankan dari folder viper-engine:
`WORKIN_TOKEN_FILE=%TEMP%\workin-sso-token.txt node --import tsx %TEMP%\workin-smoke.mts`

```ts
import { readFileSync } from 'node:fs';
import { connectMcp } from 'file:///D:/Development/App/viper-engine/src/adapters/mcp/client/connect.ts';
import { parseId } from 'file:///D:/Development/App/viper-engine/src/contracts/identity/ids.ts';
import { scopeFromAuthenticatedIdentity } from 'file:///D:/Development/App/viper-engine/src/contracts/identity/scope.ts';

const token = readFileSync(process.env.WORKIN_TOKEN_FILE!, 'utf8').trim();
const scope = scopeFromAuthenticatedIdentity({ actorId: parseId('actor', 'viper-local'), appId: parseId('app', 'viper-local') });
const owner = { scope, connection: { id: parseId('mcp_connection', 'workin-local'), serverId: parseId('mcp_server', 'gateway-v3') } };
const mcp = await connectMcp(owner, {
  kind: 'streamable_http', url: 'http://127.0.0.1:9996/api/v2/mcp',
  headers: { Authorization: `Bearer ${token}` },            // hanya header standar
}, { clock: { now: () => Date.now() }, connectTimeoutMs: 15_000, requestTimeoutMs: 30_000 });
try {
  const tools = await mcp.catalog.all();
  console.log(`T1 tools: ${tools.length}`);
  const cases: Array<[string, Record<string, unknown>]> = [
    ['hris_attendance_ping', {}],
    ['hris_attendance_list_shift_types', { search: 'shift' }],
    ['hris_attendance_search_daily', { limit: 1000000 }],      // T8: harus INVALID_PARAMETER
  ];
  for (const [name, args] of cases) {
    const tool = tools.find((item) => item.ref.name === name);
    if (!tool) { console.log(`${name}: tidak ada di tools/list`); continue; }
    const outcome = await mcp.gateway.callTool({ ...owner, runId: parseId('run', 'smoke'),
      toolCallId: parseId('tool_call', `${name}-1`), tool: tool.ref, arguments: args as never });
    console.log(`${name} -> ${outcome.status}: ${JSON.stringify(outcome.structuredContent ?? outcome.content).slice(0, 200)}`);
  }
} finally {
  await mcp.close();
}
```

## 7b. Evaluasi agen Viper (model sungguhan)

Dataset `evals/datasets/workin-live/cases.json` (40 kasus, termasuk multi-giliran dan approval yang disetujui) dijalankan oleh
`docs/integration/workin-live-eval.mts`: pertanyaan bebas → engine Viper + model terkonfigurasi →
MCP Workin; dinilai dari status run, tool yang dipanggil, fakta di jawaban, dan approval (selalu
ditolak). Laporan: `artifacts/evals/workin-live-<waktu>/report.json`. Hasil acuan pra-P07 dan
temuan engine: [handoff WORKIN-LIVE](../handoffs/WORKIN-LIVE.md).

```bash
VIPER_TEST_DB_HOST=127.0.0.1 WORKIN_TOKEN_FILE=<token> [CASES=WL-001] node --env-file=.env --import tsx docs/integration/workin-live-eval.mts
```

## 8. Tes otomatis tanpa server (cepat, sebelum uji real)

```bash
cd D:/Development/App/gateway_v3 && npm test                                  # 48 tes MCP gateway
cd D:/Development/App/service_attendance && node --test tests/mcpSession.test.js   # 9 tes MCP attendance
cd D:/Development/App/service_attendance && node mcp/scripts/check.js         # 9 tool, 0 problem
cd D:/Development/App/service_employees && node --test tests/mcpSession.test.js    # 9 tes MCP employees
cd D:/Development/App/service_employees && node mcp/scripts/check.js          # 4 tool, 0 problem, 0 warning
```

## 9. Catatan dan kendala yang diketahui

- `php artisan serve` melayani satu request sekaligus, dan request pertama setelah menganggur bisa
  8–19 detik; gateway (batas 5 detik) lalu menjawab `502 SSO validation service is unavailable`.
  Ulangi setelah SSO "hangat"; bukan bug kode.
- Data dev `db_employees`: ±199 karyawan bertanggal lahir 1 Januari (default import).
- Menjalankan attendance/gateway menulis ke file log yang ter-track (`logs/`); setelah uji jalankan
  `git restore logs` di kedua repo.
- SSO lokal perlu `forceScheme('https')` dinonaktifkan untuk http lokal (perubahan lokal, jangan
  di-commit).
- Viper (lane P05/GPT): pool koneksi sebaiknya `initialize` ulang saat gateway menjawab `404`
  (sesi kedaluwarsa), dan `-32002` dari `resources/read` dipetakan ke `not_found`.
- Belum ada: login OAuth untuk connector pihak ketiga (ChatGPT/Claude), role/permission per service.

## 10. Bersih-bersih

- Hapus file token lokal.
- Hapus data dummy: `workin-dummy-seed.cjs --cleanup …/workin-dummy-manifest.json` (bagian 4).
- Bila baris uji `user_accounts` tidak diperlukan lagi: hapus id `110792bb-ee3a-4883-b5ee-5d570ee6c3c4`
  di `db_sso`.
