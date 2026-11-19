# Development checklist R2.1

Active scope: engine MCP-first, DB baru.36/36 tasks DONE; controlled-pilot engineering acceptance, planning experimental/default off.
R2 menggantikan 52-task R1 sebelum coding. Tracker aktif berisi 9 phases/36 tasks.
Acceptance: [development plan](development-plan.md). Dependencies: [task DAG](task-dependencies.json). Status: [progress](progress.md).

## Cross-phase engine gates

- [x] Source <=300, loop <=180, function <=60, complexity <=10 enforced.
- [x] Strict TS, dependency directions dan cycle checks lulus.
- [x] Reused helpers punya provenance/behavior evidence; tidak membawa legacy categories.
- [x] Fresh schema/install tidak bergantung database V4.
- [x] MCP discovery/tools/resources/prompts sesuai capabilities dan connection ownership.
- [x] Context/model/tool-result loop dan clarification teruji.
- [x] Approval snapshot, revision, unknown outcomes dan restart recovery teruji.
- [x] API/events idempotency/replay berjalan tanpa client/desktop dependency.
- [x] Usage/quality/latency reports menyebut unmeasured/unsupported secara jujur.
- [x] Relevant checks/integration/evals dan standalone setup lulus.

Desktop, device companion, multi-agent, V4 data migration dan old-UI gateway bukan gates.
Checked engineering gates are supported by [release evidence](reports/P08-04-release.md);
live superiority/production rollout are separate from these deterministic checks.

## P00: foundation

Status phase: DONE. Evidence: progress.md, 33 tests passed dan build passed.

- [x] **P00-01** - Project skeleton
- [x] **P00-02** - Engineering gates
- [x] **P00-03** - Evaluation specification
- [x] **P00-04** - CI foundation

## P01: contracts and fresh data design

Status phase: DONE (4/4). Contracts, blueprint and API schemas verified; HTTP/database remain later phases.

- [x] **P01-01** - Identity and messages
- [x] **P01-02** - Model and MCP ports
- [x] **P01-03** - State and database blueprint
- [x] **P01-04** - Engine API schemas

## P02: selective utility reuse

Status phase: DONE (4/4). Claude utilities reviewed; token overflow fixed during integration.

- [x] **P02-01** - Adoption manifest
- [x] **P02-02** - Async components
- [x] **P02-03** - Time token and result helpers
- [x] **P02-04** - MCP errors and fingerprints

## P03: working single-agent loop

Status phase: DONE (4/4). Offline loop/input/approval/outcomes verified; durable restart belongs to P04.

- [x] **P03-01** - Context and fake components
- [x] **P03-02** - Step execution loop
- [x] **P03-03** - Budgets and cancellation
- [x] **P03-04** - Input approval and outcomes

## P04: fresh database and durable execution

Status phase: DONE (4/4). Fenced durable execution, approval, checkpoint and actual restart cases verified.

- [x] **P04-01** - New PostgreSQL repositories
- [x] **P04-02** - Claims ledger and idempotency
- [x] **P04-03** - Durable approval policy
- [x] **P04-04** - Checkpoint resume and cancel

## P05: model and MCP integration

Status phase: DONE (4/4). Actual SDK/MCP/validator/policy/durable composition and isolated E2E verified.

- [x] **P05-01** - First model adapter
- [x] **P05-02** - MCP lifecycle and tools
- [x] **P05-03** - MCP resources prompts and access
- [x] **P05-04** - End-to-end MCP execution

## P06: engine API and durable driver

Status phase: DONE (4/4). HTTP/worker/SSE/headless input/approval/usage/outcomes verified.

- [x] **P06-01** - HTTP use cases
- [x] **P06-02** - Event stream and reconnect
- [x] **P06-03** - Durable run driver
- [x] **P06-04** - API integration examples

## P07: context and measured autonomy

Status phase: DONE (4/4). Context/recall/proposals verified; optional checklist default off, ablation reported, automatic planning deferred.

- [x] **P07-01** - Context budgeting and compression
- [x] **P07-02** - Scoped recall and notes
- [x] **P07-03** - Outcome learning and maintenance
- [x] **P07-04** - Bounded planning extensions

## P08: evaluation and engine release

Status phase: DONE (4/4). Audit fixes/engineering evidence and controlled-pilot review complete; actual V4/Hermes comparison INCONCLUSIVE, external captures unmeasured. Production validation remains deployment-owned.

- [x] **P08-01** - Engine regression suite
- [x] **P08-02** - V4 Hermes comparison runner/report; external measurements NOT_MEASURED
- [x] **P08-03** - Standalone setup and operations
- [x] **P08-04** - Release evidence and extension review

## Completion records

Setiap checked task mempunyai entry progress: files, contracts/schema changes, validation
commands/results, reuse records, acceptance/limitations dan next step. Dokumen selesai tidak
mencentang implementasi. Tidak ada checkbox desktop tersembunyi dalam engine release.
