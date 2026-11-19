# P08-04: actual release evidence

Session18 November2026, Asia/Jakarta. Decision: engineering acceptance PASS;
READY_FOR_CONTROLLED_PILOT. Production certification and comparative superiority are not established.

## Final snapshot validation

| Evidence | Actual result |
| --- | --- |
| npm.cmd run check | 312 unit +159 contract =471 PASS, zero failures/skips |
| Type/lint/architecture/docs/fixture gates | PASS,0 violations |
| npm.cmd run api:export | Build/export PASS;13 SQL assets,12 API operations |
| Compiled public construction smokes | 9/9 PASS |
| Isolated PostgreSQL integration | 182/182 PASS |
| Local scripted SDK/MCP cold/warm engine trials | 60/60 PASS,6 critical groups PASS |
| Raw/source hashes and clean-copy equality | Verified; sourceDrift[] / cleanupErrors[] |
| npm registry audit after fixes | 0 reported advisories, including high/critical0 |

Final raw capture directory under artifacts/evals:
regression-2026-11-17T17-39-21-123Z-1c3ec153.
Retained: manifest.json, report.json, unit.tap, contract.tap, integration.tap and60 raw trial JSONs.
The manifest records actual working-tree hashes, installed pins and runtime/config/migration
provenance; a Git commit alone is not this snapshot's identity. Full gate log:
artifacts/p08-04-check.log. Combined verification: artifacts/p08-04-verification.json.

The earlier post-code/pre-dependency capture regression-2026-11-17T17-30-21-445Z-bba22c57 also
passed but is historical. Final acceptance uses the patched dependency capture above.

## Reproduced defects and regression evidence

Five code findings, documented with source/test references in [review](../reviews/P08-04.md):

1. Caller clock skew could take a live lease; backdated renewal could create past expiry.
2. Approval proposal writes omitted lease fencing after a run had been claimed.
3. Truncated migration assets could certify an older DB as compatible with newer code.
4. Lost owner access did not retire an idle cached MCP session.
5. Anthropic content/stop-reason contradictions could become tool decisions or successful finals.

Negative cases failed before each fix and passed afterwards. Six new regression cases total:
four PostgreSQL and two adapter contracts. Targeted lease/fencing/checkpoint suite19/19 PASS.
Logs retained in artifacts: p08-04-leases-before.tap, p08-04-schema-before.tap,
p08-04-approval-before.tap, p08-04-adapters-before.tap, p08-04-adapters-after.tap and
p08-04-targeted-run.log. These are executable behavior checks, not model self-grading.

## Dependency and clean-install validation

Pinned updates: Ajv8.17.1 ->8.18.0; tsx4.21.0 ->4.23.15; resolved esbuild0.27.7 ->0.28.2.
Before audit: one moderate Ajv entry and one low esbuild entry; after:0. Raw registry JSON:
artifacts/p08-04-npm-audit.json and artifacts/p08-04-npm-audit-after.json.
Registry advisory scope and primary links are in the [findings](../reviews/P08-04.md).
No forced out-of-range override or automated audit-fix rewrite was used.

Separate source directory artifacts/p08-04-clean-0806c0f8 was created without .env, node_modules,
dist or legacy files. It installed167 lockfile packages through:

```text
npm.cmd ci --offline --ignore-scripts --no-audit --no-fund --cache D:\Development\.npm-cache
npm.cmd run build
npm.cmd run check
```

Build and all471 offline tests/gates PASS. Its install.log, build.log and check.log retain output.
The compiled standalone-operations test in that directory passed1/1 on its own fresh random DB;
operations.tap and artifacts/p08-04-clean-operations.log retain evidence. It verifies migration/
idempotency, ops check exit codes, bind-failure cleanup, queued work recovery, authenticated probes,
drift503/live200, graceful close and caller pool ownership. This is a clean working directory on
the existing host, not a new OS VM. Both review runs used127.0.0.1:50568 and only random viper_it_*
databases; all were cleaned up and the cluster was stopped.

## Maintenance, API and future extensions

AST inventory covers272 source files. Largest source: MCP gateway186 lines; runtime max103;
longest function40; maximum complexity10. All required source/runtime/function/test/doc size,
layer, forbidden import and cycle gates PASS. No size exceptions or generated-source bypass.

Twelve versioned API operations remain; health endpoints are separate authenticated host routes.
No UI/Electron/Tauri/device coupling was added. HTTP/worker lifetimes and DB/application/model/MCP
ports preserve future desktop/separate-process paths. Backend stdio does not execute on a future
desktop client. No new schema migration or rewritten historical SQL; required version remains13.

Cache usage and optional prompt caching are preserved, default-off cache/checklist behavior
unchanged. No time-anchor/delegation/catalog-search subsystem was added during release review.

## Comparison and interpretation

The final regression was imported into comparison-2026-11-17T17-43-13-443Z-402803a7 under
artifacts/evals. Direct CLI exit2 expected; result INCONCLUSIVE, Viper10 measured fixture cases,
V4/Hermes NOT_MEASURED and superiority NOT_ESTABLISHED. No new external engine execution occurred.
Scripted token/latency counters do not demonstrate live intelligence, billed savings or a win.

[Release review](../release-review.md) records remaining live-quality/holdout, load/replica,
restore, session-cardinality, deployment identity/runtime and hosted-CI work. This audit closes
engineering roadmap acceptance; it does not certify all production environments or every
possible failure/interleaving. No commit/tag/push, production deployment or external mutation.
