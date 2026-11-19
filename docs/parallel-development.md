# Parallel development after P00

Task dependencies are authoritative in [task-dependencies.json](task-dependencies.json).
R2.1 replaces phase-wide sequencing with a task DAG, without changing the 36 task IDs/scopes.
Parallelism here means implementation agents, not a multi-agent feature inside Viper Engine.

## Round 1: completed

| Lane | Task | Owned paths | Output |
| --- | --- | --- | --- |
| Agent A | P01-01 | `src/contracts/identity/`, `src/contracts/messages/`, `tests/unit/identity/`, `tests/unit/messages/`, `docs/handoffs/P01-01.md` | Trusted identity/message/Clock/ID contracts |
| Agent B | P02-01 | `docs/reuse/P02-01.md`, `docs/handoffs/P02-01.md` | Selected utility adoption manifest; no runtime copies yet |

These two tasks ran concurrently after P00 completion. Agent B inventories
source bytes/hashes and needed symbols without choosing types that Agent A owns.
No provider credentials, legacy database or live MCP calls are needed for these two tasks.

Both P01-01 and P02-01 are now DONE; their interfaces and manifest have passed integration checks.
Historical lane prompts below describe round 1; use START_HERE and readiness for current work.

## After identity contracts merge

- P01-02 owns `src/contracts/models/`, `src/contracts/mcp/`, `tests/contract/ports/`.
- P01-03 owns `src/contracts/state/`, `docs/schema/`, `tests/unit/state/`.
- If P02-01 also merged, P02-02 owns `src/shared/async/`, `tests/unit/async/`.
- If P02-01 also merged, P02-03 owns `src/shared/time/`, `src/shared/tokens/`,
  `src/shared/results/`, and matching unit test directories.

Contract lanes import frozen identity/message contracts; shared lanes take primitive inputs.
They propose contract changes via
their handoff rather than editing another lane's files. P01-04 waits for P01-02 and P01-03.
Later model/MCP adapters and storage can be developed independently once their ports are stable;
follow the DAG rather than assuming every task in the previous phase must be complete.

## Round 2: current ownership

| Lane | Task/status | Owned paths |
| --- | --- | --- |
| C | P01-02 DONE (Codex) | `src/contracts/models/`, `src/contracts/mcp/`, `tests/contract/ports/` |
| D | P01-03 DONE (Claude + Codex review) | `src/contracts/state/`, `docs/schema/`, `tests/unit/state/` |
| E | P02-02 DONE (Claude + Codex review) | `src/shared/async/`, `tests/unit/async/` |
| F | P02-03 DONE (Claude + Codex overflow fix) | `src/shared/time/`, `src/shared/tokens/`, `src/shared/results/`, matching tests |
| G | P02-04 DONE (Codex) | `src/adapters/mcp/errors/`, `src/shared/fingerprints/`, matching tests |
| H | P03-01 DONE (Codex) | `src/agent/context/`, `tests/support/agent/`, `tests/unit/context/`, `tests/contract/context/` |
| I | P01-04 DONE (Codex) | `src/contracts/api/`, `tests/contract/api/`, `docs/api/`, `scripts/export-openapi.mjs` |
| J | P03-02 DONE (Claude + Codex review) | `src/agent/runtime/`, `src/agent/execution/`, `tests/unit/runtime/`, `tests/contract/runtime/` |
| K | P03-03 DONE (Codex) | Runtime/execution above + `src/agent/policies/`, matching runtime tests |
| L | P04-01 DONE (Claude + independent Codex review) | `src/adapters/persistence/postgres/`, persistence tests and migrations |
| M | P03-04 DONE (Codex) | `src/application/runs/`, runtime resume/context/admission hooks, workflow tests |
| N | P05-01/P05-02 DONE (Claude + Codex review/fixes) | Reviewed Anthropic and MCP lifecycle/tools adapters; matching tests |
| O | P05-03 DONE (Claude + Codex review/fixes) | MCP access/pool/context reads, connection directory and matching tests |
| P | P04-02 DONE (Claude + Codex review/fixes) | State ports, migration 0004/0006, PostgreSQL lease/idempotency/attempt stores/tests |
| Q | P05-01b OpenAI extension DONE (offline contract) | Separate OpenAI adapter/tests; live key/model not configured |
| R | P04-03 DONE (Claude + Codex review/fixes) | Durable approval snapshots/access/expiry/revise and matching tests |
| S | P04-04 DONE (Claude persistence + Codex review/application/integration) | MessageStore/CheckpointReader, atomic journal, durable driver and actual restart tests |
| T | P05-04 DONE (Codex integration) | Engine/model composition, pooled MCP routing/discovery, schema validation and actual SDK/MCP/DB E2E |
| U | P06-01 DONE (Codex integration) | HTTP controls/validation/auth, atomic API use cases, scoped snapshots/cursors/connections, migration 0008 |
| V | P06-02 DONE (Codex) | Public projection/replay, bounded HTTP SSE, atomic producer facts, retention guard/migration 0010 and tests |
| W | P06-03 DONE (Codex) | Worker entrypoint/bootstrap/application, durable retry admission/migration 0009, expiry/shutdown/OS-kill tests |
| X | P06-04 DONE (Codex) | HTTP client/reconnect, headless examples, optional usage and full-stack outcome tests |
| Y | P07-01 DONE (Codex) | contracts/context, bounded context/runtime preparation, durable checkpoints, report and regressions |
| Z | P07-02 DONE (Codex) | contracts/recall, application/recall, PostgreSQL notes/search/migration0011, context evidence and tests |
| AA | P07-03 DONE (GPT) | contracts/application/learning, scoped feedback/proposals/review, migration0012, atomic notes/audit/retirement and tests |
| AB | P07-04 DONE (GPT) | contracts/application/planning, opt-in scoped checklist evidence, paired ablation/manifest/report and tests |
| AC | P08-01 DONE (GPT) | Regression CLI/manifests/raw suites/cold-warm fixtures/grading/metrics, shared evaluation snapshots and tests |
| AD | P08-02 DONE (GPT) | Comparison CLI/protocol/verified imports, strict pairing/task statistics, coverage/report and tests; external captures unmeasured |
| AE | P08-03 DONE (GPT) | Bootstrap operations host/readiness/signals, starter/config, packaged SQL/schema guard and clean install/DB evidence |
| AF | P08-04 DONE (GPT) | Audit/fixes lease/proposal/assets/MCP/model, patched dependencies, release/extension/desktop boundary evidence |

Each also owns its docs/handoffs/<task>.md. Consult P01-01 and P02-01 handoffs before coding.
Lanes C/D consume frozen identity/messages. Shared lanes E/F remain independent of contracts:
composition maps Clock.now to primitive instants/timing callbacks, rather than importing a
domain Clock type into shared. Do not edit another lane's files or the root export barrel.

E/F integration completed with 130 tests/build passing; the overflow
[review note](reviews/P02-03.md) is resolved. P03-01 uses frozen model/MCP contracts and P02
helpers. Test history fixtures do not create competing production store ports while lane D
was under review. P00-P08 are DONE (36/36). No R2.1 DAG task remains; select a new scope only from
the user's assignment and [release follow-up evidence](release-review.md). Read P08-04 handoff/report.
Actual V4/Hermes comparison remains INCONCLUSIVE with captures
NOT_MEASURED. Planning remains experimental/default off.
Reuse createViperEngine and the P04-04 driver/journal; coordinate bootstrap/http.ts, server route
registration, shared cursor changes and root exports with integration owner. P07 follows the task DAG.
Read P03-03/04 handoffs before changing runtime/workflow: final admission, dispatchState and
retained in-memory budgets are invariants for durable checkpoint/approval integration.

## Integration owner

One integration owner controls package/lockfiles, tsconfigs, root exports, tooling, CI,
task graph, checklist, progress, START_HERE, baseline manifest and global specifications.
Workers write their task-specific handoff files. The integration owner reconciles acceptance,
updates shared status/checklist, and runs the full gate after merging.

Use separate Git branches/worktrees once a repository is available. Without isolation, retain
exclusive path ownership, do not revert others' edits, and avoid concurrently running installs.
Do not commit, push or provision/deploy merely because the plan mentions branches or CI.

## Per-agent validation

Run relevant tests, `npm run typecheck`, `npm run lint`, and `npm run check:architecture`.
Report exact results and limits. Avoid broad formatter/autofix runs across other lanes.
If a needed interface is missing, record the proposal and wait for its owning task to merge;
do not create a duplicate interface or bypass a layer boundary.

Before marking DONE, the integration owner runs `npm run check` and `npm run build` on the
combined tree. Completed task dependencies must be DONE, enforced by the docs checker.
CI configuration exists; hosted CI execution requires this project to be the repository root
or an explicitly adapted monorepo workflow. No remote CI run is claimed by local checks.

## Copyable prompts

```text
Agent A: kerjakan P01-01 di D:\Development\App\viper-engine.
Baca START_HERE.md, AGENTS.md dan docs/parallel-development.md.
Ikuti path ownership lane A; jangan edit shared config/checklist/progress.
Tulis hasil/commands/evidence di docs/handoffs/P01-01.md untuk integration owner.
```

```text
Agent B: kerjakan P02-01 di D:\Development\App\viper-engine.
Baca START_HERE.md, AGENTS.md, reuse inventory dan parallel-development.md.
Fokus adoption manifest docs/reuse/P02-01.md; jangan salin runtime atau ubah contracts.
Tulis handoff di docs/handoffs/P02-01.md; jangan edit shared config/checklist/progress.
```
