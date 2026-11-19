# Viper Engine release review

Decision,18 November2026: **READY_FOR_CONTROLLED_PILOT** on the validated local stack.
P00-P08 engineering roadmap acceptance is complete (36/36). This decision covers the tested
standalone engine and its documented host boundaries; production rollout remains a deployment task.

Five reproduced defects were fixed during P08-04, including lease clock skew and missing approval
proposal fencing. Two dependency advisories were remediated. Read [findings](reviews/P08-04.md)
and [actual evidence](reports/P08-04-release.md) before adopting the candidate.

Post-review extension: [local tool discovery](tool-discovery.md) now provides env auto/on/off.
Its [validation report](reports/tool-discovery.md) records486 offline/184 PostgreSQL/60 engine trials
and current source hashes. P08-04 counts/hashes below remain the earlier audit snapshot. Live
Workin/Margin retrieval quality and threshold tuning remain separate acceptance evidence.

## What is ready

- Durable MCP-first loop with exact approval/input, owner/app/tenant scope, bounded budgets,
  journal/checkpoints, cancellation and deliberate unknown-outcome recovery.
- Existing Anthropic/OpenAI model adapters, HTTP/stdio MCP, context/recall/reviewed proposals,
  versioned HTTP/SSE/client contracts and separate or combined workers.
- Standalone setup with a new DB, complete packaged SQL, schema-before-polling startup,
  authenticated health/readiness and an operations/recovery runbook.
- Pinned regression/comparison tooling with raw evidence and honest missing baseline coverage.
- Enforced source/function/complexity/layer/cycle limits. Source maximum186 lines, runtime maximum
  103, function maximum40 and complexity maximum10 on this snapshot.

Validation:312 unit +159 contract =471 offline tests;182 isolated PostgreSQL tests;60/60 scripted
engine trials; build/OpenAPI/9 compiled public smokes PASS. A second clean source installation with
167 lockfile packages also passed build/check and compiled startup on its own fresh database.
No application/legacy data, Redis or desktop dependency was required.

## Adoption boundaries

Use the [single-owner loopback starter](standalone-operations.md) for a controlled local pilot.
Its authentication is one configured actor/app, its MCP selection is a fixed list of at most32
existing owner connections, and every callable requires exact approval. It is not a multi-user
identity/OAuth provisioning service. A custom host owns those adapters and credential handling.

Retain stable scope/cursor secrets and compatible model/catalog/policy on resume. Ship all dist
assets and node_modules/runtime metadata together. Run migrations explicitly before starting
workers; newly added SQL requires updating ENGINE_SCHEMA_VERSION in bootstrap/schema-version.ts.
No migration was added or rewritten by this audit; current schema remains0013/21 tables plus ledger.

Host clocks must be maintained for local deadlines and timestamps. PostgreSQL now owns lease
claim/renewal duration time; a caller clock cannot grant early takeover. Worker death still does
not provide exactly-once guarantees for arbitrary remote effects. Reconcile unknown outcomes.

## Extensions reviewed

| Extension | Disposition |
| --- | --- |
| Cache usage fields X01 | Retained; whole input includes cached prompt parts, details recorded in model_calls; no measured billed saving |
| Anthropic prompt caching X02 | Retained opt-in/off by default, scripted wire tests pass; live paired quality/cache benefit unmeasured |
| Stable tool sorting X04 | Retained deterministic alias order; large-catalog accuracy/token-cost measurements remain pending |
| Advisory checklist P07-04 | Retained opt-in/off by default; scripted preservation evidence, no automatic planning promotion |
| Time anchor X03 / catalog stress/search X05/X06 | Planned/deferred; no new runtime system authority or discovery mechanism introduced |
| Future desktop/delegation | Deferred product scope; reviewed API/port boundaries only, no shell/device/agent subsystem added |

Core has no Next.js/Electron/Tauri/UI dependency. Client disconnect does not cancel a durable run;
HTTP/worker processes can be separated using existing factories. MCP stdio runs on the backend
host. Desktop-local execution/pairing/storage needs its own future permission and product design.

## Evidence still required for broader rollout

| Item | Current state / required follow-up |
| --- | --- |
| Live model/business quality and real provider/MCP access | Scripted fixtures verified; run representative authorized business cases with real providers/connectors |
| V4/Hermes superiority | NOT_ESTABLISHED; latest comparison INCONCLUSIVE because external captures are NOT_MEASURED |
| Quality/holdout/latency/cost targets | Ten scripted development cases do not meet120 independent tasks/30 holdout live comparison gates |
| Capacity/multi-host fairness | Local concurrency/recovery tested; certify target throughput, pool capacity, replica behavior and DB/network failures under deployment load |
| MCP session cardinality | Sessions live until retirement/release/shutdown; bound configured connection population per worker; global idle eviction/quota is not implemented |
| Backup/disaster recovery | Runbook supplied; perform a real restore rehearsal and reconcile effects after the backup before enabling writes |
| Deployment identity/TLS/secrets/monitoring | Deployment-owned adapters/configuration; readiness does not test remote credentials or replace private diagnostics |
| Runtime/platform certification | Local Windows/Node22.16/PostgreSQL18 verified; hosted Ubuntu/Windows CI, other versions, rolling upgrades and OS/runtime security patching are separate validation |

The registry audit currently reports0 advisories after the pin updates. New advisories and host
runtime patches must be reviewed on subsequent releases; this snapshot is not permanent security
certification. No production deployment, Git release tag, commit/push or external publication was
performed. Actual working-tree source hashes are the candidate identity, including uncommitted files.

Start from [setup](standalone-operations.md), [runbook](operations-runbook.md) and
[P08-04 handoff](handoffs/P08-04.md). There is no next active R2.1 DAG task; future work should be
selected from these explicit measurements/deployment needs with its own scope.
