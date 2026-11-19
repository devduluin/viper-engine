# Engine regression evidence

P08-01 provides a reproducible correctness runner with immutable, timestamped local report folders.
It uses scripted decisions and local fixtures; live semantic quality and V4/Hermes comparison remain
NOT MEASURED. Expected failure/unknown/refusal is a passing safety check when its evidence is correct.

## Commands

```text
npm run eval:offline
npm run eval:regression
npm run eval:regression -- --repeats=1
```

`eval:offline` executes the complete unit/contract suites, saves TAP and a source manifest, and marks
PostgreSQL/cold-warm trials NOT_RUN. It requires no database or provider credentials.
`eval:regression` additionally executes all PostgreSQL integrations and10 synthetic engine cases,
three repeats in cold/warm pairs (60 trials). Optional repeats1..3 support diagnosis; the actual
repeat count and sample sizes are recorded. Both commands exit nonzero on failed/missing/skipped/
cancelled test evidence, missing/duplicate engine trials, failed grades, cleanup failures or source drift.

Provide explicit loopback `VIPER_TEST_DB_*` per [persistence handoff](handoffs/P04-01.md). No command
loads `.env` or reads provider keys. The PostgreSQL helper creates/drops only its own random
`viper_it_*` databases. Host owns the review server; runner never starts/stops an arbitrary DB service.
API/server credentials are synthetic, model fetch is intercepted, and MCP endpoints are loopback.
Live Workin runners/configuration remain a separate authorized integration, not invoked here.

## What actually runs

Offline evidence reuses all existing unit/contract tests. PostgreSQL mode also runs the complete
integration suite with file concurrency4, retaining crash/lease/approval/idempotency/HTTP/SSE/
context/recall/learning tests as critical evidence. A coverage matrix pins actual test filenames;
missing critical files fail the report. Test children receive platform paths and explicit test-DB
settings only; provider keys and unrelated environment variables are not forwarded.

Engine trials compose the actual production engine, PostgreSQL journal, authenticated HTTP client,
MCP SDK with a real loopback server and Anthropic SDK with fixed fetch replies. The clarification
case uses the scripted provider-neutral model port because the engine's needs_input decision is
tested directly there. This difference and unavailable usage are recorded, not hidden as SDK usage.

Cases: [engine-regression-v1](../evals/datasets/engine-regression/README.md).

| Case | Required evidence |
| --- | --- |
| ER-001 final | One audited model call, no dispatch |
| ER-002 dependent reads | lookup -> add, actual persisted sum8, exact tool sequence |
| ER-003 valid empty | successful empty rows, not a fabricated error |
| ER-004 accepted write | pending exact count5 approval, one consumed dispatch/effect |
| ER-005 declined write | rejected approval, explicit rejected_by_user, zero effects |
| ER-006 tool error | persisted error, failed run despite fluent scripted output |
| ER-007 invalid arguments | invalid_value refusal, zero remote dispatch/effects |
| ER-008 unknown write | one effect, unknown tool outcome, partial run and no replay |
| ER-009 clarification | waiting input, exact revision/input identity, completed continuation |
| ER-010 cancellation | cancellation before model/discovery, zero attempts/effects |

Every trial also checks foreign actor/tenant404, an idempotent start returning the original run,
another driver delivery remaining idle and no extra model/tool effects on observation. Assertions
use persisted model/tool/approval/history data, not model claims. A refusal can finish a dialogue
with status completed while its operation remains rejected and unexecuted; these are separate checks.

## Cold/warm and accounting

Cold means first delivery on a fresh engine/SDK/MCP pool. Warm means a second independent run and
conversation on that same engine; effect counters reset before each trial. Repeat pairs use fresh
isolated DB/server/engine instances. A warm label does not promise a catalog/provider cache hit;
actual catalog page requests are counted. Cancellation may establish no MCP session at all.

Trial latency starts before conversation/start HTTP requests and ends after reading the final run
snapshot. It includes automatic synthetic input/approval handling and engine loopback/SQL work;
setup/migrations, grading, foreign reads and replay assertions are excluded. This is local fixture
latency, not production/user think time, provider networking, OS cold start or billable performance.
Per-case and aggregate p50/p95 use nearest rank with explicit n. Repeats are not independent tasks.

Usage comes from the actual run snapshot/model audit, but SDK token counters are **scripted fixture
values**, not real consumption. Scripted-port unknown fields remain unknown. Totals separate known
counts and unknown trials per field; cost is null. All model attempts and remote dispatches count;
there is no hidden planner/judge call. Optional planning/recall is off for these baseline trials.

## Evidence layout and reproducibility

Each invocation creates artifacts/evals/regression-<UTC timestamp>-<random suffix>/:

- manifest.json: actual working-tree SHA256 hashes, dataset/scripts/tests, installed versions
  checked against exact package pins, Node/OS/CPU, concurrency, scope and measurement definitions.
- unit.tap, contract.tap and integration.tap when requested: raw complete test output and exit status.
- ER-*-<repeat>-<cold|warm>.json: resolved config/budgets, actual server catalog/endpoint, PostgreSQL
  version/migration checksums, model request bodies, run snapshot/history/ledger and grade checks.
- report.json: suites, critical coverage, trial identities, per-mode/per-case usage/latency, failures,
  cleanup errors, source drift and SHA256 checksums of all other evidence files.

Source manifests are captured before and after execution, including added/deleted files. Drift
fails the run. Hidden files/env/artifacts are excluded; symlinked code or paths outside the declared
root are refused. Headers, DB passwords and process environment maps are never serialized.
Data is synthetic; do not repurpose this raw recorder for private/live requests without a separate
retention/redaction review. Hashes detect drift, not authorship or a signature on a benchmark claim.

The foundation manifest remains historical; no dataset/rubric hash is silently replaced. Existing
Workin live manifests/trials/compare preparation are retained separately. Generated reports pin the
working tree they actually executed, not an assumed Git commit or an undocumented live provider.

## Boundaries

This runner proves tested deterministic invariants, not general semantic model completion rates.
The10 development cases are not the120-task/30-holdout comparison target. Live cost/quality, real
provider cold/warm latency, and V4/Hermes scores remain NOT MEASURED. P08-02 owns comparison work;
P08-03/P08-04 own standalone operations and release review. No desktop/delegation/legacy migration,
deployment, live credentials or production database access is authorized by these commands.

See [P08-01 handoff](handoffs/P08-01.md) and [review](reviews/P08-01.md) for actual execution results.
