# Viper Engine: instructions for implementation agents

## Scope and current state

This directory is a standalone backend project beside `../ai-intent-api-v2`.
P00/P01/P02/P03/P04/P05/P06 and P07-01/P07-02/P07-03 are DONE (31/36).
Anthropic/OpenAI and MCP access adapters are reviewed; OpenAI live smoke awaits configured access.
P04-04 includes reviewed persistence, atomic journal and durable application driver with restart tests.
Read progress and P04-02/03 review notes before durable work: fenced writes, explicit wake,
idempotency claimId and database-time expiry are required. P05-04 real adapter E2E is complete;
P06-01 provides authenticated HTTP controls; P06-03 provides the bounded durable worker host.
P06-02 provides public durable SSE/replay; P06-04 provides headless HTTP/SSE integration and usage.
P07-01 provides bounded context and verified extractive checkpoints. P07-02 provides scoped recall/
explicit user notes and fresh user-role evidence. P07-03 provides reviewed outcome proposals,
exact user confirmation and atomic feedback retirement. P07-04 bounded planning is next. Read
P07-01/02/03 handoffs before touching context/notes/proposals/checkpoints. Workin live handoff is triaged
in docs/reviews/WORKIN-LIVE.md. The separate user-declined approval fix is DONE; read
docs/handoffs/WORKIN-REJECTION.md for exact binding, sticky denial and report-code compatibility.
MCP HTTP404 session retirement/resource -32002 handling is DONE; read WORKIN-MCP-SESSION handoff.
Host setup diagnostics and live Workin revalidation remain pending. Learning requires migration0012;
never promote assistant/tool answers directly into user notes or bypass their source/owner FK.
Work only on the task authorized by the user; a roadmap is not permission to deploy,
change production data, access credentials, or implement every phase in one turn.

Specification R2 supersedes the earlier 52-task R1 roadmap; R2.1 introduces task-level DAG
dependencies and P00 completion. Read actual status in progress/checklist, not an old summary.
The owner requires a new MCP-first engine, a new database, and maintainable reusable components.
Do not reproduce V4's tools/knowledges/skill categories, intent tables, or legacy routing pipeline.
The selected primary stack is TS/Node/Fastify. Desktop is future planning only, not current work.

## Read order

1. `START_HERE.md` and `README.md`.
2. `docs/progress.md` and `docs/development-checklist.md`.
3. Your phase in `docs/development-plan.md`.
4. `docs/engineering-standards.md` and `docs/architecture.md`.
5. Relevant contracts: MCP design, database, API, evaluation, or reuse inventory.
6. `docs/agent-handoff.md` before reporting completion.

Read relevant documents, not every legacy file or unrelated secret-bearing files.
No delegation or subagents are required by this file.

## Mandatory maintainability constraints

- Maximum 300 physical lines per handwritten source file, including blanks/comments.
- Runtime loop coordinator maximum 180 physical lines.
- Functions/methods maximum 60 physical lines, cyclomatic complexity maximum 10.
- Tests maximum 400 physical lines per file; split by behavior when larger.
- New/edited Markdown files maximum 300 physical lines.
- Generated output may exceed the limit only if reproducible from a named input/command
  and placed in the generated-output paths defined by the architecture checker.
- Do not label handwritten code, schemas, or prompts as generated to bypass limits.
- Split by responsibility before a limit is reached. Do not minify lines or
  introduce meaningless helpers merely to satisfy a counter.
- No exceptions for copied legacy source. Extract/adapt it before adoption.
- CI gates must enforce size, complexity, dependency boundaries, and cycles.

## Architecture constraints

- `contracts` has no model SDK, database, Fastify, desktop-shell, or legacy imports.
- `agent` depends on contracts and approved platform-neutral `shared` components only.
- `application` orchestrates agent use cases and storage ports.
- `adapters` implement ports. `bootstrap` constructs concrete instances.
- `entrypoints` translates transport messages into application calls.
- Shared components must be cohesive: `shared/async`, `shared/time`, etc.; no giant `utils.ts`.
- Do not import sibling legacy source at runtime or add a TS path alias to it.
- Do not copy a legacy planner/coordinator as the new engine implementation.
- New PostgreSQL schema is independent from V4. No legacy schema/data migration is required.
- Tools mean MCP callables; resources/prompts retain MCP semantics, not legacy categories.
- No KnowledgeStore/SkillStore, intent/vector pipeline, or legacy compatibility layer by default.
- Do not import Electron/Tauri or UI state into the backend core.
- Do not implement desktop/device pairing/companion/SDK, local shell/browser platform, or
  delegated agents now. Preserve ports and versioned APIs for future extensions only.
- Resolve trusted user/tenant scope on the server; never trust a user ID in request JSON.

## Reuse

Consult `docs/reuse-inventory.md` before writing a duplicate helper.
Copy/adapt selected existing utilities where their behavior remains suitable.
Record source path, SHA-256, exported symbols, destination, changes, license/provenance,
and characterization results. Capture the actual current working-tree content,
not an assumed clean Git revision.

Pure helpers may live under `shared`; infrastructure-specific helpers belong to adapters.
Timeout is not cancellation. An empty result is not automatically a failure.
Do not use the short MD5 cache fingerprint as an approval integrity mechanism.
Do not inherit a memory-only lock fallback for distributed correctness.

## Runtime invariants

- Persist conversation, run, step, and tool-call identities separately.
- Core exposes client-neutral versioned API and event contracts for future clients.
- Closing a client connection is not a request to cancel a durable run.
- Resume never automatically redispatches a completed external action.
- Remote write timeout/crash may yield unknown outcome; reconcile before retry.
- Approval binds exact scope, run, tool version, and final parameters.
- Model suggestions, external context, and MCP output cannot grant new permissions.
- No desktop execution endpoints/contracts need implementation in the current engine phases.
- Do not promise exactly-once execution of arbitrary remote tools.
- Multi-agent work is a later runtime feature, not a prerequisite for single-agent correctness.

## Task discipline

- Task IDs and dependencies are in `docs/development-plan.md`.
- Exact dependencies are in `docs/task-dependencies.json`; parallel lane ownership is in
  `docs/parallel-development.md`. Workers write task handoffs, integration owner updates shared status.
- Use `docs/progress.md` to record claims and exact handoff state; do not erase prior evidence.
- Keep checklist items unchecked until acceptance criteria and required validation pass.
- If checks cannot run, report why, what remains, and the exact command attempted.
- One task or cohesive vertical slice at a time. Do not bundle unrelated rewrites.
- See `docs/tooling.md` for existing commands; do not claim future integration/eval scripts exist.
- Update contract/docs/checklist/progress when implementation changes the plan.
- Prefer tests of state transitions, authorization, idempotency, and failure boundaries.
- No live model/MCP credentials are needed for scripted/fake-component tests.
- Any credentialed/live integration follows the user's provider/access decisions
  and applicable session instructions; do not copy `.env` from the sibling project.

## Definition of done

Task behavior and negative cases pass; required typecheck/lint/architecture checks pass;
no new size/boundary violations; API compatibility is accounted for; provenance is recorded
for reused code; progress includes files, commands/results, remaining risks, and next task.

Engine rollout requires relevant evaluation/operational gates; desktop and legacy migration
are deferred. Do not mark a phase, release, or benchmark win complete based on a partial
implementation or prose alone.
