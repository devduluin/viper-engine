# Local tool discovery extension

Status: DONE, GPT,18 November2026. User authorized implementation with env on/off/auto.
This is a post-R2.1 extension; the36-task completed roadmap is unchanged.

Design: authorized backend catalog separated from active model schemas. Auto uses count OR token
threshold; on always searches; off uses eager catalog. viper__search_tools is a reserved internal
control, never an external MCP action. Search activates real schemas for later native tool calls;
all business calls retain existing policy/approval/journal admission.

State: settings/mode, bounded search count, active versioned bindings and bounded private exchanges
persist in existing JSON execution checkpoints. Discovery transcripts project into provider context
in order, without canonical history/notes/approval authority. Pre-extension running checkpoints
retain eager behavior. No migration or provider-native API feature required.

## Read order and files

Read `docs/tool-discovery.md`, then `docs/reports/tool-discovery.md` and this handoff.
Contracts: `src/contracts/discovery/{config,state}.ts`. Core: `src/agent/discovery/` contains
catalog snapshots, lexical BM25, closed search arguments, search schema and run controller.
`agent/runtime/discovery.ts` handles the local control without external dispatch; model-step admits
only a single control call. `agent/context/transient.ts` projects bounded private paired exchanges.
Context compression projects them after canonical excerpts are selected; their content is not facts.

Durable `state/context-state/events/session` save/restore discovery in existing execution JSON.
`application/runs/session-catalog.ts` preserves it during in-memory input/approval refresh.
`bootstrap/tool-discovery-config.ts` is the explicit environment parser, publicly exported.
Engine options and standalone wire it through; custom hosts must inject the parser themselves.
Workin live-eval also injects the parser and pins resolved settings in its manifest. Its full catalog
token baseline is labeled separately from actual active request schemas. Wiring was checked statically;
no live runner execution or model/MCP/token-counter calls were made.
No dependency or SQL migration was added; API operations remain12, schema version13 unchanged.

## Review and reuse

Review found in-memory catalog refresh rebuilt the eager index independently of the saved controller.
Both paths now share controller restoration; new approval/input negative tests prevent hidden dispatch
and check model schemas/private search results survive. Actual underlying MCP approval remains exact.
Search ceilings stop repeated controls; output/transcript/context limits fail closed. Reserved alias
collisions, mixed batches, duplicate IDs, stale versions, foreign scope and catalog overflow refuse.

Direct internal reuse: `indexTools`, `mcpToolKey`, `createFingerprint`, `estimateTextTokens`, JSON/
message parsers, runtime budgets/control, exact policy/approval dispatch and checkpoint journal.
No legacy code copied/imported or duplicate infra helpers; no external provenance entry required.
Tests reuse existing scripted model/MCP fixtures, actual SDK fake fetches and isolated PG helpers.

## Validation

`npm run check`:325 unit +161 contract =486 PASS, zero failures/skips; type/lint/architecture/docs/
fixtures PASS. `npm run api:export`: build PASS,13 SQL assets packaged,12 public API operations.
Nine compiled public smokes plus exported discovery config/env smoke PASS without I/O.
`npm run discovery:report`:400/1000/3000 synthetic catalogs show1 initial/2 after exact selection
schemas, hidden distractors remain inaccessible. Raw `artifacts/discovery/catalog-scaling.json`.
Full isolated PostgreSQL184/184 and60/60 engine trials PASS, no source drift or cleanup errors.
Raw capture: `artifacts/evals/regression-2026-11-17T18-37-28-601Z-4cee403d`.
`artifacts/discovery/verification.json` verifies raw hashes and current working-tree source identity.
AST inventory:283 source files, largest186/runtime109/function40/complexity10. Review cluster50568
stopped; only random `viper_it_*` databases created/dropped. No application DB or `.env` access.

## Limits and next work

No live keys/provider/Workin/Margin/app DB calls, deployment, desktop or native tool-search migration.
Lexical retrieval has no multilingual semantic guarantee. Exact-alias stress is structural evidence,
not a task quality, billing, latency or Hermes/V4 benchmark. Next authorized quality evaluation should
use real schemas and Indonesian/English tasks with distractors, permissions and approval negatives.
Source/runtime/function/complexity caps remain required; no new DAG task was created.
