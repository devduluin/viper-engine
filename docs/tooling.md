# Foundation tooling

P00 provides strict TypeScript ESM build, local AST gates, Node test runner and Ajv fixture
validation. API schemas, bounded runtime and actual model SDK/MCP composition are implemented.
P06-01 HTTP control, P06-02 durable SSE and P06-03 worker host are implemented.
Live credentials are not needed by checks. The P04-01 persistence handoff
owns isolated PostgreSQL configuration; P05-04 adds actual SDK/local MCP integration cases.

## Setup

Node 22.16.x / npm; dependency versions are pinned in package.json and package-lock.json.
From this project root run `npm ci --ignore-scripts --no-audit`, `npm run check`, `npm run build`.
PowerShell with script restrictions can use `npm.cmd` instead of `npm`.
No `.env` is auto-loaded. `parseFoundationConfig(env)` reads an injected map, ignores unrelated
variables and returns only foundation env/host/port/log-level configuration. It opens no port.

## Implemented commands

| Command | Behavior |
| --- | --- |
| `npm run build` | Compile source to dist + declarations |
| `npm run api:export` | Build and export API v1 OpenAPI data to artifacts/openapi/v1.json |
| `npm run example:headless` | Local fixture demo; optional .env for VIPER_TEST_DB_*, scripted provider |
| `npm run context:report` | Offline context ablation report to artifacts/context/p07-01.json; no .env/key/DB |
| `npm run example:recall` | Explicit isolated DB recall/note lifecycle + scripted SDK/MCP demo, no .env/key |
| `npm run example:learning` | Isolated feedback/proposal/review/retirement demo with scripted SDK/MCP, no .env/key |
| `npm run planning:report` | Six scripted paired checklist ablations with source hashes/raw requests; no .env/key/DB, quality unmeasured |
| `npm run typecheck` | Strict source/TS-test check without emit |
| `npm run lint` | AST size/complexity, explicit-any, eval and type-bypass checks |
| `npm run check:architecture` | File/function metrics, static resolution/layers/cycles |
| `npm run check:docs` | Markdown size/links/fences, task/DAG/checklist consistency |
| `npm run test:unit` | Tooling, contracts/state, utilities, context and bounded runtime tests |
| `npm run test:contract` | API/model/MCP schemas and deterministic fake-runtime traces |
| `npm run test:integration` | Explicit isolated PostgreSQL tests; separate from offline check |
| `npm run eval:validate` | Schema/references/dataset hash validation; no agent score |
| `npm run eval:manifest` | Explicit reviewed dataset/source snapshot capture |
| `npm run check` | All current offline validation gates and tests |
| `npm run tasks:ready` | Task-DAG readiness; ownership still checked in progress/handoffs |

`eval:offline` and `eval:compare` are future commands; deterministic runtime fixtures currently
run in test:contract. The fixture validator is not an execution/scoring command. Test runners
fail if the selected suite has no tests. PostgreSQL tests follow P04-01 isolated configuration;
their success is separate evidence and is never inferred from npm run check.

## AST policy

TypeScript compiler API parses .ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts source. Function size includes
signature/body physical lines and nested callbacks are checked individually. Complexity counts
if/conditional/loops/catch/non-default switch cases, boolean/nullish branches, optional access,
and parameter/binding defaults. Nested functions do not inflate the parent's count.
Source <=300, tests <=400, functions <=60, complexity <=10. Every source module under
`src/agent/runtime/` has the stricter 180-line cap so renaming a coordinator cannot bypass it.

Production dependency checks resolve TypeScript paths/aliases and inspect static imports,
type imports, reexports, import types, dynamic import and literal require. Nonliteral module
paths fail. Production imports outside the project or into test/tooling code fail. Source
symlinks fail closed. Different adapter families communicate through ports/composition.

Pure shared runtime imports currently allow only node:crypto, node:buffer, node:util and
node:timers/promises. Core runtime imports SDKs/frameworks only through adapters, not directly.
Additional shared packages need an explicit policy review/test; there is no package wildcard.

No generated source is registered in P00. Files under `src/generated/` are rejected, including
files merely labeled generated. Before using generated-code exemptions, add a reviewed
reproducible generator registry/verification task. dist/node_modules/coverage/artifacts are
non-source outputs and never imported by production source as project modules.

## CI scope

Workflow runs install/check/build on Ubuntu and Windows with Node 22.16.0. Dependency download
requires registry access; validation after install is offline and has no secret/provider/DB needs.
The workflow is a project-root template; local success does not imply a hosted CI run occurred.

References: [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API),
[Node test runner](https://nodejs.org/api/test.html), [Ajv](https://ajv.js.org/).
