# Viper Engine

> **@devduluin/viper-engine** — Core Agentic Engine berbasis protokol Model Context Protocol (MCP) untuk ekosistem AI Duluin.

Viper Engine adalah library runtime agen modular yang menangani orkestrasi model AI (Anthropic Claude & OpenAI), eksekusi tool MCP secara aman, alur persetujuan manusia (*human-in-the-loop*), manajemen memori percakapan, serta streaming event real-time (SSE) dengan persistensi PostgreSQL.

Engine ini dirancang **domain-agnostic** (bebas dari logika bisnis spesifik), sehingga dapat digunakan oleh host runner seperti `viper-host` untuk memberdayakan berbagai asisten AI di seluruh aplikasi Duluin.

---

## Arsitektur & Cara Kerja

```text
┌─────────────────────────────────────────────────────────────────┐
│                          Host App                               │
│              (misalnya: viper-host, CLI, Runner)                │
└───────────────────────────────┬─────────────────────────────────┘
                                │ createViperEngine(...)
┌───────────────────────────────▼─────────────────────────────────┐
│                         Viper Engine                            │
│                                                                 │
│   ┌────────────────────┐   ┌────────────────────────────────┐   │
│   │   Agent Runtime    │   │      Context Budgeting         │   │
│   │  (Loop, Planning)  │   │  (Token Window, Compression)   │   │
│   └─────────┬──────────┘   └────────────────┬───────────────┘   │
│             │                               │                   │
│   ┌─────────▼──────────┐   ┌────────────────▼───────────────┐   │
│   │   Model Adapters   │   │      MCP Client Transport      │   │
│   │ (Anthropic/OpenAI) │   │ (Streamable HTTP, Pool Access) │   │
│   └────────────────────┘   └────────────────┬───────────────┘   │
│                                             │                   │
│   ┌─────────────────────────────────────────▼───────────────┐   │
│   │      State, Checkpoint & Approval Store (PostgreSQL)    │   │
│   └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP / SSE
┌───────────────────────────────▼─────────────────────────────────┐
│                          MCP Gateway                            │
│                 (Workin, Invoice, Payroll, dll)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Fitur Utama

1. **MCP-First Architecture**:
   Engine berkomunikasi dengan backend eksternal menggunakan standar resmi **Model Context Protocol (MCP)** melalui Streamable HTTP. Seluruh tool diekspos secara otomatis ke model AI.
2. **Human-in-the-Loop Approval Workflow**:
   Tool yang bersifat mengubah data (*write/mutative actions*) otomatis ditahan dalam status `waiting_for_approval`. Sistem menghasilkan kartu persetujuan dan hanya mengeksekusi aksi setelah pengguna memberikan keputusan eksplisit.
3. **Dynamic Tool Discovery**:
   Mampu menangani katalog puluhan hingga ribuan tool tanpa membuat context window model meluap. Engine memuat schema tool secara terarah (*just-in-time / search-based*).
4. **Durable & Stateful Persistence**:
   Semua percakapan, event, langkah eksekusi, token usage, dan status approval tersimpan secara transaksional di PostgreSQL dengan mekanisme *checkpoint* dan *lease recovery*.
5. **Real-Time SSE Event Streaming**:
   Menyediakan streaming Server-Sent Events (SSE) untuk kata per kata, indikator proses berpikir agen (*agent thinking/planning*), dan status eksekusi tool dengan dukungan *reconnect & cursor replay*.

---

## Persyaratan Sistem

* **Node.js**: `>= 22.16.0 < 23`
* **PostgreSQL**: `16+` (direkomendasikan PostgreSQL 18)

---

## Instalasi & Perintah Utama

Install dependensi menggunakan `npm ci`:

```bash
npm ci --ignore-scripts --no-audit
```

### Script Development

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run check` | Menjalankan seluruh verifikasi: typecheck, linting AST, arsitektur, dan evaluasi skema. |
| `npm run build` | Mengompilasi TypeScript ke direktori `./dist` dan menyalin file migrasi SQL PostgreSQL. |
| `npm run typecheck` | Menjalankan validasi TypeScript tanpa emit (`tsc --noEmit`). |
| `npm run lint` | Memeriksa aturan penulisan kode, batas baris, dan kompleksitas fungsi AST. |
| `npm run test:unit` | Menjalankan unit test lokal berbasis runner bawaan Node.js test. |
| `npm run test:contract` | Menjalankan kontrak API, validasi schema, dan skenario offline. |
| `npm run api:export` | Mengekspor spesifikasi OpenAPI ke `artifacts/openapi/v1.json`. |

---

## Cara Penggunaan (Quick Start)

Viper Engine biasanya diimpor sebagai dependensi pustaka oleh host server (seperti `viper-host`):

```typescript
import {
  createViperEngine,
  createEngineHttpServer,
  parseConfiguredModelConfig,
  parseId,
} from "@devduluin/viper-engine";

// 1. Inisialisasi Model AI (Anthropic Claude atau OpenAI)
const model = parseConfiguredModelConfig(process.env);

// 2. Buat instance Viper Engine
const engine = createViperEngine({
  model,
  // Port kredensial SSO user
  credentials: {
    resolve: async (scope) => ({
      ok: true,
      credential: { kind: "bearer", token: getUserToken(scope.actorId) },
    }),
  },
  // Mapping endpoint MCP gateway
  resolveEndpoint: (server) => ({
    kind: "streamable_http",
    url: server.endpointRef,
  }),
  // Menghubungkan koneksi MCP per user
  connections: async (scope) => [
    { id: parseId("mcp_connection", "conn-workin"), namespace: "workin" },
  ],
  // Kebijakan eksekusi tool: read-only langsung jalan, aksi tulis butuh persetujuan
  policy: {
    decide: (tool) =>
      tool.definition.annotations?.readOnlyHint === true
        ? "execute"
        : "requires_approval",
  },
});

// 3. Pasang ke HTTP & SSE Server
const server = await createEngineHttpServer(engine, {
  cursorSecret: Buffer.from(process.env.VIPER_CURSOR_SECRET!, "hex"),
  authenticate: async (request) => verifyAuthToken(request),
});

await server.listen({ host: "0.0.0.0", port: 4300 });
console.log("Viper Engine siap melayani di port 4300");
```

---

## Konfigurasi Environment Variables

Berikut variabel lingkungan utama yang didukung engine:

### 1. Model Provider & API Keys
* `VIPER_MODEL_PROVIDER`: Provider utama (`anthropic` atau `openai`). Default: `anthropic`.
* `ANTHROPIC_API_KEY`: API Key Anthropic jika menggunakan model Claude.
* `VIPER_MODEL`: Nama model Claude (misal `claude-sonnet-4-6` atau `claude-3-5-sonnet-latest`).
* `OPENAI_API_KEY`: API Key OpenAI jika menggunakan provider OpenAI.
* `VIPER_OPENAI_MODEL`: Nama model OpenAI (misal `gpt-4o`).

### 2. Database PostgreSQL
* `VIPER_DB_HOST`: Host database PostgreSQL.
* `VIPER_DB_PORT`: Port database (default `5432`).
* `VIPER_DB_NAME`: Nama database.
* `VIPER_DB_USER`: Username database.
* `VIPER_DB_PASSWORD`: Password database.
* `VIPER_DB_POOL_MAX`: Kapasitas koneksi pool (default `10`).

### 3. Tool Discovery
* `VIPER_TOOL_DISCOVERY_MODE`: Mode katalog tool (`auto`, `on`, atau `off`). Default: `auto`.
* `VIPER_TOOL_EAGER_MAX_COUNT`: Batas maksimal tool yang dimuat langsung ke schema model (default `30`).

---

## Struktur Direktori

Kode sumber di dalam folder `src/` disusun dengan arsitektur berlapis (*layered architecture*):

```text
src/
├── contracts/       # Definisi tipe, interface ID, pesan, skema event, dan error code
├── agent/           # Logika inti agen: loop runtime, context budgeting, memory, dan planning
├── adapters/        # Implementasi port eksternal:
│   ├── models/      # Adapter ke SDK Anthropic dan OpenAI
│   ├── mcp/         # Klien HTTP transport MCP dan connection pooling
│   └── persistence/ # Driver database PostgreSQL transaksional
├── bootstrap/       # Factory builder (createViperEngine, createEngineHttpServer, dll.)
└── entrypoints/     # HTTP endpoint Fastify dan background worker loop
```

---

## Standar Kualitas & Batas Kode (*Engineering Standards*)

Repositori ini menerapkan aturan kualitas kode yang ketat yang diverifikasi otomatis pada saat `npm run check`:
* Tidak ada `any` eksplisit (strict TypeScript).
* Ukuran maksimal file: $\le 300$ baris (runtime loop $\le 180$ baris).
* Ukuran maksimal fungsi: $\le 60$ baris.
* Kompleksitas siklomatis AST per fungsi: $\le 10$.
* Bebas dependensi melingkar (*no circular dependencies*).
