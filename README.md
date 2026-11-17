# Viper Engine

Backend agentic MCP-first baru dengan TypeScript/Node.js dan database baru.
**P00-P06 dan P07-01/02/03 DONE (31/36). Check: 427 tests; PostgreSQL: 167 tests.**
Build dan OpenAPI export lulus; lihat [progress](docs/progress.md).
Offline loop/input/approval, reviewed PostgreSQL policy stores dan Anthropic/OpenAI/MCP adapters tersedia.
Durable claim/restore/approval/cancel dan restart proses tersedia. Model/MCP E2E composition
tersedia melalui createViperEngine. createEngineHttpServer menyediakan 12 operasi HTTP/SSE dengan auth,
revision dan idempotency. createEngineWorker menjalankan bounded polling/durable retry terpisah
dari HTTP. SSE mendukung durable replay/reconnect dengan cursor scoped dan bounded backpressure.
createEngineClient dan contoh headless menyediakan input/approval, read-only reconnect serta usage/outcomes.
Budget konteks menjaga active work/pairing, dengan bounded extractive checkpoint dan report API.
createEngineRecall menyediakan scoped search/user notes dan evidence segar sebelum model call.
createEngineLearning menyediakan [reviewed proposals](docs/outcome-proposals.md), konfirmasi pengguna dan retirement saat feedback direvisi.
Live OpenAI belum diuji. Lihat [HTTP](docs/http-api.md), [SSE](docs/event-stream.md),
[worker](docs/worker-host.md), [headless client](docs/headless-client.md),
[composition](docs/engine-composition.md), [context](docs/context-budgeting.md) dan [driver](docs/durable-driver.md).

Mulai dari [START_HERE](START_HERE.md). Pembagian agen: [parallel development](docs/parallel-development.md).

## Setup dan checks

Node 22.16.x. Dari root project:

```text
npm ci --ignore-scripts --no-audit
npm run check
npm run build
npm run api:export
```

PowerShell dengan execution policy ketat dapat memakai `npm.cmd`.
`build` menghasilkan library di dist; `api:export` menulis artifacts/openapi/v1.json.
Keduanya tidak membuka server/port atau memakai API key.
`parseFoundationConfig(env)` menerima environment map yang diinjeksi, tanpa auto-load .env.

P00 menyediakan strict compilation, AST engineering gates, docs/task-DAG checks, unit/contract
runner, JSON Schemas, fake MCP fixture service dan 9 scenario definitions. Detail commands
ada di [tooling](docs/tooling.md). CI workflow disediakan untuk project sebagai repository root.

## Fokus engine

Context -> model -> MCP action -> result -> model -> final/pause. Durable conversation/run,
approval, ownership, budgets dan recovery. Resources/prompts mengikuti protocol semantics;
tidak membawa taxonomy tools/knowledges/skill, intent pipeline atau schema V4.

Acuan prinsip: [Hermes Agent](https://github.com/NousResearch/hermes-agent). Keunggulan atas
Hermes/V4 belum diukur; fixture validation tidak menjadi benchmark score.

## Stack dan maintenance

TypeScript/Node.js, Fastify ketika HTTP diimplementasikan, PostgreSQL melalui persistence port.
Redis opsional bila dibutuhkan; model/MCP SDK terisolasi di adapters. Utility V4 boleh dicopy
secara selektif dengan provenance/tests, tanpa source import atau credential/DB reuse.

Source <=300 lines, seluruh agent/runtime modules <=180, functions <=60, complexity <=10.
Komponen satu tanggung jawab, dependency injection, dan dependency cycles ditolak.
Desktop/UI/delegation/data import V4 ditunda; API/adapter boundaries menjaga extensibility.

## Dokumentasi

- [START_HERE](START_HERE.md), [AGENTS](AGENTS.md), [parallel lanes](docs/parallel-development.md).
- [Architecture](docs/architecture.md), [MCP design](docs/mcp-first-design.md).
- [Database design](docs/database-design.md), [API contract](docs/api-contract.md).
- [Plan](docs/development-plan.md), [task graph](docs/task-dependencies.json), [checklist](docs/development-checklist.md).
- [Engineering standards](docs/engineering-standards.md), [tooling](docs/tooling.md).
- [Reuse](docs/reuse-inventory.md), [evaluation](docs/evaluation-plan.md), [fixture rubric](evals/rubric.md).
- [Progress](docs/progress.md), [handoff](docs/agent-handoff.md), [future desktop](docs/desktop-backend-contract.md).

R2.1 mempertahankan 36 task dan mengizinkan task independen berjalan paralel melalui DAG.
Identity/messages, model/MCP contracts, utilities, context dan deterministic offline fixtures
tersedia. [API guide](docs/api/README.md) dan [P01-04 handoff](docs/handoffs/P01-04.md)
menjadi acuan HTTP/events berikutnya. [Workflow handoff](docs/handoffs/P03-04.md) dan
[PostgreSQL review](docs/reviews/P04-02.md) serta [approval review](docs/reviews/P04-03.md)
menjadi dasar durable restore/cancel. Baca [P04-04 handoff](docs/handoffs/P04-04.md)
untuk atomic journal/restart evidence, serta [P05-04 handoff](docs/handoffs/P05-04.md)
untuk E2E wiring; [P06-01 handoff](docs/handoffs/P06-01.md) menjelaskan HTTP dan
[P06-03 handoff](docs/handoffs/P06-03.md) menjelaskan worker; [P06-02 handoff](docs/handoffs/P06-02.md)
menjelaskan SSE/replay. [P06-04 handoff](docs/handoffs/P06-04.md) mencakup headless examples.
[P07-01 handoff](docs/handoffs/P07-01.md) mencakup context budgeting/compression;
[P07-02 handoff](docs/handoffs/P07-02.md) mencakup scoped recall/notes (migration0011).
[P07-03 handoff](docs/handoffs/P07-03.md) mencakup outcome proposals dan atomic retirement (migration0012).
P07-04 bounded planning/ablation adalah next DAG task.
[Workin follow-up](docs/handoffs/WORKIN-REJECTION.md) membedakan approval ditolak pengguna dari
penolakan izin; perbaikan teruji offline/integrasi, live Workin revalidation masih pending.
[MCP session/resource follow-up](docs/handoffs/WORKIN-MCP-SESSION.md) juga selesai tanpa replay otomatis.
