# Engineering standards: mandatory

Status: P00 tooling enforces current TS/JS metrics, imports/cycles and documentation rules.
Implemented commands and exact checker behavior are documented in [tooling](tooling.md).

## Size and responsibility

| Unit | Hard limit | Design target |
| --- | --- | --- |
| Handwritten source `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, or future `.py` | 300 physical lines | 80-200 lines |
| Main runtime loop coordinator | 180 physical lines | Orchestration only |
| Function/method | 60 physical lines | One operation |
| Cyclomatic complexity per function | 10 | Straightforward branches |
| Test file | 400 physical lines | One scenario family |
| Markdown document | 300 physical lines | One topic |

Physical lines include comments and blanks. Function checks must parse the language AST,
including anonymous callbacks and nested functions. Complexity checks must report file/function.
Generated output and package-manager lockfiles are excluded from source-size checks.
P00 registers no generated source; `src/generated/` is rejected. Before enabling generated-code
exemptions, implement a reviewed reproducible generator registry/verification task. Output must
have a named input/command and live under `src/generated/` or `artifacts/generated/`.
Handwritten artifacts cannot use a generated label to bypass checks.

Oversized files fail CI without a per-file waiver. Split by behavior and ownership.
Avoid shrinking readability, changing formatting, or moving huge functions into strings.
Prompt templates belong in named `.md` assets with versions and a 300-line limit.
Large fixtures/schema data live outside source; they must not hide executable behavior.

## Component design

- Dependency injection at stable boundaries; no service locator or global mutable singleton.
- Contracts describe business/runtime capabilities, not one SDK's request object.
- Pure logic accepts data and returns data. I/O is explicit through a port.
- Inject Clock, ID generation, usage accounting, and event sinks where determinism matters.
- A helper reused across components has one owned implementation and focused tests.
- Do not introduce an interface for a one-line private helper.
- No domain keyword/tool-slug routing embedded in the general agent runtime.
- New database and MCP discovery replace legacy category/intent registries; do not recreate them.
- Desktop/device/companion components are deferred; API/ports remain client-neutral.
- Strict TypeScript; no unchecked `any` in contracts, runtime, or application.
- SDK-boundary unknown data is validated before crossing into typed core.
- Use feature folders and named small files; avoid `manager.ts`/`service.ts` catch-all growth.

## Allowed dependency graph

| Layer | May import |
| --- | --- |
| `contracts` | Other contracts, standard type primitives |
| `shared` | Standard library, focused dependencies approved for the component |
| `agent` | Contracts, shared, other agent modules without cycles |
| `application` | Contracts, shared, agent, other application use cases without cycles |
| `adapters` | Contracts, shared, SDKs/infrastructure libraries |
| `entrypoints` | Application, contracts, transport libraries |
| `bootstrap` | Composition of all layers |

Shared cannot import agent/application/adapters/entrypoints/bootstrap. Adapter implementations
do not import one another to resolve dependencies; compose ports in bootstrap instead.
No sibling-repo imports, circular imports, or core imports of server/client shell SDKs.
Use language-aware dependency analysis, not only text searches.

## Validation command contract

P00 implements foundation scripts and pins tools/versions in the package lockfile. Integration,
runtime eval and comparison scripts remain future work until the relevant behavior exists.
Use local installed executables;
do not depend on implicit network installs from `npx`.

| Command | Must verify |
| --- | --- |
| `npm run typecheck` | Strict source/test compilation without emit |
| `npm run lint` | Coding rules, function size/complexity, unchecked boundary data |
| `npm run check:architecture` | File limits, dependency directions, cycles, forbidden imports |
| `npm run test:unit` | Deterministic component and runtime scenarios |
| `npm run test:integration` | Explicitly provisioned persistence/transport boundaries |
| `npm run test:contract` | Engine API/events/model/MCP contracts |
| `npm run eval:offline` | Versioned fixtures with scripted model/tools |
| `npm run eval:compare` | Controlled engine comparison and raw evidence report |
| `npm run eval:validate` | Existing fixture/schema/hash validation, no agent scoring |
| `npm run check:docs` | Local links, task IDs, checklist coverage, document limits |
| `npm run check` | Typecheck, lint, architecture, docs, unit and contract checks |

Test scripts are introduced when relevant tests exist. Unimplemented checks must not return
fake success. Live integration/evaluation commands require explicit environment configuration;
they are not part of every local smoke check.

If Python is introduced, implement equivalent AST size/complexity/import checks and tests
for that component. It does not relax these boundaries or justify rewriting the TS core.

## Reuse and change review

Characterize behavior before adapting nontrivial legacy utilities. Document intentional
changes separately from mechanical extraction. Preserve ownership/license metadata.
Do not copy caches, credentials, service singletons, or database dependencies into shared.

Test boundaries that can fail independently: retries after timeouts, approval revisions,
transaction claims, reconnect cursors, and cross-user/device scope. Avoid tests that merely
repeat implementation branches without checking useful behavior.

Any new capability includes a versioned contract, a narrow owner module, acceptance cases,
observable outcomes, and a handoff note. Public APIs use structured errors and stable codes;
UI text can change without changing workflow state.
