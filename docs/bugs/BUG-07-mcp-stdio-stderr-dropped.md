# BUG-07: Pesan Error MCP Stdio Subprocess Hilang Karena `stderr: 'ignore'`

## 1. Ringkasan Masalah

Pada modul `src/adapters/mcp/client/transport.ts` (baris 38-45):
```typescript
function stdioTransport(config: Extract<McpTransportConfig, { kind: 'stdio' }>): StdioClientTransport {
  if (config.command.trim().length === 0) throw new Error('MCP stdio command is required');
  return new StdioClientTransport({
    command: config.command,
    args: [...(config.args ?? [])],
    ...(config.env === undefined ? {} : { env: { ...config.env } }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    stderr: 'ignore', // <--- SELURUH STDERR DIABAIKAN
  });
}
```

Ketika membuat `StdioClientTransport`, opsi `stderr` diatur ke `'ignore'`.

## 2. Dampak pada Operasional

Server MCP yang dijalankan sebagai child process (misalnya binary Node.js, script Python `uvx`, atau CLI tools) menuliskan seluruh pesan diagnostik kritis ke `stderr`:
- Stack trace saat crash (*unhandled exception* / *syntax error*).
- Kegagalan otentikasi atau missing dependencies (misal `ModuleNotFoundError`).
- Error permission saat mengakses filesystem lokal.

Dengan opsi `stderr: 'ignore'`, seluruh aliran teks tersebut dibuang (*discarded*).  
Jika server MCP gagal menyala atau crash tiba-tiba di tengah sesi, Viper Engine hanya menerima sinyal generic `EPIPE` atau process exit code tanpa ada informasi penyebab sedikit pun di log sistem. Pengembang atau administrator tidak memiliki cara untuk mengetahui alasan kegagalan server MCP.

## 3. Solusi & Rekomendasi

1. Ganti `stderr: 'ignore'` menjadi stream handler atau buffer terbatas:
   - Tangkap output `stderr` child process ke dalam circular memory buffer berukuran wajar (misalnya maksimal 16 KB).
2. Teruskan isi buffer tersebut ke `appLogger` atau sertakan dalam objek error `McpFailure` ketika koneksi subprocess terputus tidak wajar.

## Re-audit (Claude, 17 November 2026)

Remediasi `'inherit'` / `'pipe'` diganti dengan capture ring buffer sesuai rekomendasi di atas. Lihat
[BUG-12](BUG-12-mcp-stdio-stderr-pipe-unconsumed.md).
