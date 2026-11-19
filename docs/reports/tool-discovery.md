# Local tool discovery validation

18 November2026. Post-R2.1 extension; the36-task completed roadmap is unchanged.
Implementation/configuration: [guide](../tool-discovery.md), [handoff](../handoffs/TOOL-DISCOVERY.md).
Final whole-tree gates and isolated regression PASS; raw evidence is recorded below.

## Structural catalog measurement

Command: `npm run discovery:report`. Raw: `artifacts/discovery/catalog-scaling.json`.
Fixture: synthetic HR distractors and one exact accounting alias, source-filtered query `journal`.

| Authorized tools | Full schema bytes | Initial search bytes | After selection bytes | Approx full tokens | Approx after tokens |
| --- | --- | --- | --- | --- | --- |
| 400 | 108877 | 595 | 654 | 17889 | 117 |
| 1000 | 272677 | 595 | 654 | 44799 | 117 |
| 3000 | 820676 | 596 | 655 | 134785 | 117 |

Initial schema count1, after selection2 in each case. Hidden distractor lookup is refused.
These are serialized structural estimates. The target schema is intentionally small; real Workin/
Margin schemas and provider framing will change the totals. This is not a measured billing,
latency, model accuracy, Indonesian recall, or Hermes/V4 superiority result.

## Regression coverage

- Env strict parsing, auto count OR token thresholds, forced on/off, bounded scope/catalog,
  reserved alias refusal, lexical source filtering, active schema/search ceilings.
- Saved settings, owner/run/version mismatch refusal, canonical history privacy, duplicate control
  IDs, mixed search/business batch refusal, guessed hidden calls and context compression.
- In-memory approval/input catalog refresh retains lazy visibility and private exchanges.
- Actual Anthropic and OpenAI SDK request bodies use the reserved function initially and then
  the actual selected typed function; paired private search results are serialized correctly.
- PostgreSQL restart after committed discovery restores state despite changed host config;
  actual MCP approval binds exact arguments, is consumed once, and creates only a real MCP ledger
  row. Hidden calls create neither external effects nor executable ledger intent.

The refresh review found an in-memory path that rebuilt a full eager index while keeping a lazy
controller. Shared `application/runs/session-catalog.ts` now restores the controller with saved
settings and selected versioned refs. Two negative resume tests verify the resulting boundary.

## Final commands and raw evidence

| Command / evidence | Result |
| --- | --- |
| `npm run check` |325 unit +161 contract =486 PASS, zero failures/skips; all static/docs/fixture gates PASS |
| `npm run api:export` | Build PASS,13 SQL assets,12 API operations |
| Full isolated `eval:regression` |325 unit,161 contract,184 PostgreSQL tests,60/60 engine trials PASS |
| Compiled public smokes |9 previous factory/provider smokes +1 discovery config/env smoke PASS |
| `npm run discovery:report` |400/1000/3000 structural assertions PASS |

Check log: `artifacts/tool-discovery-check.log`. Full raw capture:
`artifacts/evals/regression-2026-11-17T18-37-28-601Z-4cee403d`, including `manifest.json`,
`unit.tap`, `contract.tap`, `integration.tap`, trial JSON and `report.json`.
Verification: `node --import tsx artifacts/discovery/verify.mts` produces
`artifacts/discovery/verification.json`; raw hashes and actual current source identity match,
with no source drift or cleanup errors. AST:283 source modules, largest186 lines, runtime max109,
function max40, complexity max10. Review port50568 stopped; only random `viper_it_*` databases.
No live provider, Workin/Margin, credentials, app/V4 DB, production deployment or desktop changes.

## Limits and next validation

Mode auto defaults are operational starting points, not empirically optimal thresholds. Search
adds a model round trip; small authorized catalogs remain eager under both thresholds. Active
schemas accumulate without eviction. A run pins its effective mode/config; new runs re-evaluate.
Hard caps and ordinary context/run budgets can still stop a request. Configuring catalog limits
cannot override current owner/access policy or host connection/page ceilings.

Next: live Indonesian/English Workin+Margin query eval with realistic schemas, distractors and
permission cases, measuring tool recall/task success/cache/input/billing/latency. Provider-native
search/semantic indexing should depend on that evidence. Existing P08-04 historical reports and
hashes describe the earlier release snapshot; they are not validation hashes for this extension.
