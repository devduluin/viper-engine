# Local MCP tool discovery

Post-R2.1 extension,18 November2026. The authorized MCP catalog stays on the backend;
the model receives a bounded set of function schemas. Existing execution, approval and journal
contracts continue to apply to the actual MCP tool and final arguments.

## Modes and environment

The standalone host (`npm run start:local`) explicitly injects these values from its environment.
Copy the settings from `.env.example`, adjust them, and restart the host. Settings affect new runs;
an existing checkpoint keeps its original settings and effective mode through resume.

| Environment variable | Default | Meaning / maximum |
| --- | --- | --- |
| `VIPER_TOOL_DISCOVERY_MODE` | `auto` | `auto`, `on`, `off` |
| `VIPER_TOOL_EAGER_MAX_COUNT` | `30` | Eager count threshold, max1000 |
| `VIPER_TOOL_EAGER_MAX_TOKENS` | `6000` | Approximate schema token threshold, max100000 |
| `VIPER_TOOL_SEARCH_TOP_K` | `5` | Candidate tools per search, max20 |
| `VIPER_TOOL_ACTIVE_MAX_TOKENS` | `8000` | Activated business schema budget, max100000 |
| `VIPER_TOOL_SEARCH_MAX_CALLS` | `8` | Searches per run, max32 |
| `VIPER_TOOL_CATALOG_MAX_TOOLS` | `10000` | Backend catalog ceiling, max10000 |

Numeric values must be positive safe integers; invalid configuration fails at startup.
Blank/unset values use defaults. Threshold equality permits eager mode; exceeding either threshold
activates discovery. Token estimates use the existing deterministic text estimator, not a provider
tokenizer. The ordinary context/input/output/model-call/duration limits still apply.

- `auto`: eager when count **and** estimated schema tokens fit; otherwise search first.
- `on`: always search first, including small catalogs.
- `off`: offer the full authorized catalog, subject to catalog and context limits. A large request
  can fail the context budget; disabling discovery does not bypass it.

For a count threshold of100:

```dotenv
VIPER_TOOL_DISCOVERY_MODE=auto
VIPER_TOOL_EAGER_MAX_COUNT=100
VIPER_TOOL_EAGER_MAX_TOKENS=6000
```

An80-tool catalog with expensive schemas can still activate search. Force it with `on`, or disable
it with `off`. Mode and limits are per engine configuration; there is no unauthenticated runtime
toggle or new HTTP API operation.

## Custom hosts

Library factories never implicitly read `.env` or `process.env`. Existing custom HTTP/worker hosts
must inject the exported parser into `createViperEngine(pool, options)` or the corresponding
HTTP/worker composition's `engine` options. The same setting works with either model binding:

```ts
import { createViperEngine, parseToolDiscoveryConfig } from 'viper-engine';

const engine = createViperEngine(pool, {
  ...existingOptions,
  toolDiscovery: parseToolDiscoveryConfig(process.env),
});
```

Direct typed configuration is also supported: `toolDiscovery: { mode: 'on', searchTopK: 3 }`.
With no override, library factories use the same `auto` defaults. Direct `RunLoopInput` and durable
host `configure` callbacks can supply `toolDiscovery` with the same contract.
The existing Workin live-eval runner also injects this parser and pins resolved nonsecret settings
in its manifest. Its catalog token counter measures the full catalog baseline, not active schemas.
Host discovery limits (`maxTools`, `maxPages`, `maxConnections`) are additional ceilings;
`maxTools` defaults to the configured catalog ceiling. Never silently truncate a catalog.

## Model interaction

1. Resolve current authorized connections/tools for the trusted scope using the existing MCP gateway.
2. In discovery mode, expose only `viper__search_tools` initially. Its description includes a bounded
   list of source namespaces and counts; full business schemas/descriptions remain on the backend.
3. The model calls search alone with `{ "query": "journal", "source": "margin" }`.
   `source` is optional; it is the exact alias namespace before `__`, or the connection ID for
   an alias without a namespace. Queries are1..512 characters, sources1..128.
4. Local lexical BM25 ranks names, descriptions and schema text. The result identifies matches,
   loaded names and skipped names. Selected actual schemas appear on the **next** model request.
5. The model calls the actual loaded MCP function, using its real typed arguments. The ordinary
   argument validator, policy, exact approval, journal and dispatch path handle the operation.

There is no generic tool invocation bridge. A guessed hidden alias cannot dispatch. Combining
search and business calls in the same model batch is an invalid model response. The reserved
`viper__search_tools` alias cannot be assigned to an external MCP tool, including with mode off.
Search is a local control: it performs no external MCP call, grants no permission and consumes no
business tool-call reservation. It consumes a model call, normal run steps/time/output budget,
and the separately persisted search allowance. Exceeding that allowance stops with
`tool_search_limit`; repeated searches and invalid queries also count toward the allowance.

Activated schemas accumulate in stable catalog order for the rest of the run. They are not evicted
to make space. A candidate exceeding the active schema budget is reported as skipped. Empty search
results are explicit; there is no fallback that sends the full catalog to the model.
The active budget covers business schemas; the search schema and messages remain subject to the
ordinary total context budget. Hard limits also include8MiB serialized backend catalog,32 source
namespaces and256KiB private discovery transcript. Inputs exceeding them fail closed.

## Resume and persistence

Discovery settings, effective mode, search counter, active versioned tool references and private
assistant/tool search exchanges persist in the existing versioned execution JSON checkpoint.
No SQL migration is required. Private exchanges are projected in order into provider context;
they do not become canonical conversation messages, user facts, notes, public tool results or
executable MCP call-ledger rows. Provider token usage still includes the context actually sent.

Catalog refresh after approval, new input or worker restart rechecks trusted scope and active
tool versions. Removed/changed definitions cease to be active. Approval still binds the exact
real MCP operation and arguments. Completed external effects retain the existing no-replay behavior.
The effective auto decision is pinned for a run; fresh runs reevaluate current catalog size.
Pre-extension running checkpoints without discovery state retain eager behavior for compatibility.
Changing env does not silently change admission or search limits for an already running checkpoint.

## Evidence and remaining work

Run `npm run discovery:report` to produce `artifacts/discovery/catalog-scaling.json`.
It measures synthetic400/1000/3000-tool catalogs, exact-alias retrieval and serialized schemas;
it does not measure live reasoning, provider billing, latency or multilingual retrieval quality.
Tests separately cover scope/version refusal, budget ceilings, hidden calls, both actual model SDK
request formats, compressed context, in-memory input/approval resume and PostgreSQL restart/approval.
See [handoff](handoffs/TOOL-DISCOVERY.md) and [validation report](reports/tool-discovery.md).

Search is lexical; it handles Unicode/camel case and simple plural normalization but has no
translation model or embeddings. The search description asks the model to try alternate wording
including English when needed. Real Workin/Margin Indonesian queries and selection accuracy need
a separately reported live eval before tuning default thresholds or claiming semantic improvements.
Provider-native deferred search, curated core tools, semantic retrieval and cross-run activation
are follow-ups; this extension uses the same local control with both current model adapters.
