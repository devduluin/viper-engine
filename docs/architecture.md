# Viper Engine architecture

Revision R2. Target desain, belum implementasi. Current scope: engine MCP-first dan DB baru.
[START_HERE](../START_HERE.md) menjelaskan keputusan pemilik dan jalur baca.

## Prinsip

Hermes menjadi acuan siklus model/tool, history, context management dan provider boundary.
Viper mengadopsi prinsip tersebut dengan komponen TypeScript dan persistence baru.
[Hermes loop reference](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md)

Tidak mempertahankan taxonomy tools/knowledges/skill, intent examples/mappings, adjudicator
atau vector intent pipeline V4. Tidak membutuhkan parity semua fitur V4 sebelum engine berjalan.
Reuse dibatasi pada utilitas/logika yang sesuai, bukan mengimpor arsitektur legacy.

## Alur runtime

```text
Input -> load conversation/run -> assemble context + available MCP tools
                                 |
                               model
                                 |
           +---------------------+-----------------------+
           |                     |                       |
       tool call             needs input             final answer
           |                     |                       |
    schema/access/policy    checkpoint/pause       persist/complete
           |
    approval needed? -- yes -> checkpoint/pause
           |
           no
           |
    persist dispatch intent -> MCP call -> persist outcome -> model
```

Model memilih tindakan. Runtime memvalidasi, menjaga scope/approval/budget dan mengeksekusi.
Tidak wajib decomposition atau LLM adjudication tambahan pada setiap permintaan.
Parallel calls hanya untuk operasi independen yang diizinkan policy. Hasil kosong dapat sah;
transport error, MCP `isError`, auth failure dan unknown outcome dibedakan.

## MCP-first capability model

Catalog diambil dari MCP server yang diakses pengguna; namespaced IDs mencegah tabrakan.
Definitions/cache difilter berdasarkan connection scope dan diperiksa ulang saat dispatch.
Resources dan prompts memakai semantics MCP; tidak dipetakan ke knowledge/skill categories.
Rincian: [MCP design](mcp-first-design.md).

Procedural playbooks atau memory jangka panjang dapat ditambahkan setelah loop stabil jika
memberi manfaat terukur. Tidak ada executable skill registry baru. Built-in runtime controls
misalnya clarification/approval adalah application actions, bukan custom plugin taxonomy.

## Batas dependensi

```text
entrypoints -> application -> agent + contracts
adapters ------------------> contracts
shared --------------------> komponen platform-neutral
bootstrap -----------------> composition root
```

`contracts` tidak mengimpor SDK/database/framework. `agent` bergantung contracts dan shared.
`application` mengatur sesi/run/approval melalui ports; adapters mengimplementasikan I/O.
`bootstrap` merangkai instances, bukan global service locator. Detail dependensi dan CI limits
ada di [engineering standards](engineering-standards.md).

## Struktur target

Buat directory saat ada implementasinya, bukan semua sebagai placeholders.

```text
viper-engine/
  src/
    contracts/              # Messages/actions, model/MCP/state/event ports
    shared/                 # Async, time, token, result components
    agent/
      runtime/              # Loop dan narrow step handlers
      context/              # Prompt/history selection, compression
      execution/            # Call validation, scheduling, outcome handling
      policies/             # Budget, approval, retry, access decisions
    application/
      conversations/        # Conversation/input lifecycle
      runs/                 # Start/continue/cancel/resume
      approvals/            # Proposal/decision/consumption
      connections/          # MCP connection lifecycle use cases
    adapters/
      models/               # Provider-specific gateway
      mcp/                  # Discovery, transport, resources/prompts, calls
      persistence/          # New PostgreSQL schema/repositories/migrations
      auth/                 # Trusted principal mapping, credential references
      observability/        # Structured traces, metrics, events
    entrypoints/
      http/                 # Fastify API/streaming
      worker/               # Durable run driver, when introduced
    bootstrap/              # Configuration + dependency wiring
  tests/
  evals/
  docs/
```

Optional later modules, only when a task needs them: context recall/notes, planning,
background maintenance and artifact storage. No desktop/devices/legacy adapters in initial tree.

## Data model and state

PostgreSQL adapter uses a new schema with conversation/message/run/step/model-call/tool-call,
MCP connection/server, approval, event and idempotency entities. No legacy foreign keys or
resource-category columns. [Database design](database-design.md) owns the logical model.

Run statuses: `queued`, `running`, `waiting_for_input`, `waiting_for_approval`, `completed`,
`partial`, `failed`, `cancelled`. Unknown outcome is a tool-call execution state requiring
reconciliation, not a guessed terminal verdict. No waiting-for-device state is needed now.

Pause/resume addresses explicit conversation/run IDs and revisions. New topics can create
new runs. State is scoped to trusted principal/app and tenant if deployment needs it.
Persistent tool-call outcomes prevent automatic replay of completed effects. A crash after
remote action and before outcome persistence can remain unknown; arbitrary remote tools do
not provide an exactly-once guarantee.

## Engine interfaces

| Port/contract | Responsibility |
| --- | --- |
| ModelGateway | Normalized messages, tool calls/content, usage, streaming, cancellation |
| McpGateway | Discovery/read/get/call through an authorized connection |
| ConnectionStore | Server definitions, per-principal binding and secret references |
| RunStore | Checkpoint, revision, claims, steps and tool outcomes |
| ConversationStore | Messages and summaries with scoped access |
| ApprovalStore | Immutable snapshot and atomic decision/consumption |
| EventSink/Store | Durable sequenced events and ephemeral status/deltas |
| Clock/IDs | Deterministic time and correlation for tests |

Use only interfaces needed by the current task. No DeviceGateway/SkillStore/KnowledgeStore
contracts in the engine foundation. TypeScript callable contracts are not legacy DB tools.

## Context and memory

Begin with conversation history and tool outcomes. Preserve call/result pairing and current
unresolved work during compression. Add scoped notes/recall on P07; use basic DB search before
requiring a vector stack. Generated answers are not automatically user facts.
Procedural instructions may become an optional context source, not a mandatory catalog category.

## Scaling and future clients

One modular codebase; HTTP/worker can become separate processes over the same persistence ports.
Database claims/leases, durable events, bounded concurrency and backpressure support horizontal
scale. Start without unnecessary distributed services. Future desktop consumes the same API;
local tool execution would arrive as a new execution adapter and separate feature scope.
No desktop companion, device pairing or local shell executor is built in P00-P08.

## Delivery

A working engine is the release target: MCP multi-step execution, input/approval pause,
recovery, API/events, context management and measured evaluation. Read [development plan](development-plan.md).
Desktop, multi-agent, old-UI compatibility and data import are future work, not engine blockers.
