# Engine composition

`createViperEngine(pool, options)` is the standalone composition boundary. It connects the
reviewed durable driver to an injected model, PostgreSQL connection directory, authorized MCP
session pool, discovery/aliases, JSON Schema validation and mandatory host policy.
The engine creates no HTTP listener, worker daemon, credentials or database implicitly.
Model context now has a default [bounded selection/checkpoint policy](context-budgeting.md).
Configure the actual provider window explicitly through options.context; full canonical evidence
is retained for resume/approval. Optional RunSnapshot.context reports the latest preflight view.
Optional contextEvidence retrieves fresh user-role data per call through the scoped
[recall/notes service](scoped-recall.md); it cannot supply instructions or persist generated facts.

## Host setup

1. Configure a **new engine database** and apply migrations through 0011 (current notes/recall plus lease/replay).
2. Build a model binding with `parseConfiguredModelConfig(env)` and
   `createConfiguredModelBinding(config, clock)`, or inject `{ provider, model, gateway }`.
3. Supply a credential port and endpoint resolver over trusted server definitions. Endpoint
   resolution selects a backend command or HTTP endpoint; model output cannot select one.
4. Select connections from authenticated scope and checkpoint with `connections(scope, checkpoint)`.
5. Supply `policy.decide(tool, call)`: execute, requires_approval or reject. There is no implicit
   grant based on server annotations, tool names or model suggestions.
6. Call `engine.runOnce(workerId, optionalHostShutdownSignal)`, or use the [P06-03 worker](worker-host.md).
7. On host shutdown, await `engine.close()`, then close the host-owned database pool.

Composition skeleton (the host supplies `pool`, `env`, `credentialPort`, endpoint/connection
selection and `executionPolicy`; these are application integrations, not built-in permissive defaults):

```ts
import {
  createViperEngine, parseConfiguredModelConfig, createConfiguredModelBinding,
} from 'viper-engine';

const clock = { now: () => Date.now() };
const engine = createViperEngine(pool, {
  clock,
  model: createConfiguredModelBinding(parseConfiguredModelConfig(env), clock),
  credentials: credentialPort,
  resolveEndpoint,
  connections: selectOwnedConnections,
  policy: executionPolicy,
});

try {
  const delivery = await engine.runOnce('worker-1');
  // idle: no claim; yielded: another delivery must recover; settled: persisted status.
  consumeDelivery(delivery);
} finally {
  await engine.close();
  await pool.end();
}
```

Explicit environment map only: no automatic `.env` import or sibling configuration. Provider
selection is anthropic by default, or openai. Existing parsers retain their settings; OpenAI
requires an explicit `VIPER_OPENAI_MODEL`. Both SDK retry defaults remain zero. The OpenAI
adapter uses Chat Completions; configure a model/endpoint that supports that API. Responses
and other provider features are not negotiated by this factory.

## Discovery and authorization

- Each delivery discovers the currently selected, owner-authorized connections. Every pooled
  operation rechecks ownership/auth/revocation; a cached SDK gateway cannot bypass access.
- Optional namespace: 1-16 lowercase letters/digits, starting with a letter. Default namespaces
  are deterministic hashes of connection IDs. Remote tool names receive stable safe aliases.
- Aliases map back to exact connection/server/name/definition-version bindings. Duplicate
  connection IDs, namespaces or ambiguous tools fail before model generation.
- Resources and prompts retain their MCP ports and authorization. Discovery does not
  automatically read resources, invoke prompts, or turn them into legacy categories.
- Credentials remain in the credential/transport boundary, never model context or storage config.
  HTTP requires HTTPS except loopback. Stdio executes only host-configured backend commands.

Default limits: 32 connections, 20 catalog pages per connection, 1024 total tools, 30s discovery,
20s connect and 10s request. Acquisition may use the connect allowance before the SDK request
allowance; caller deadlines and run limits bound both. Discovery/setup is also bounded by the
durable configuration lease timeout. Tune these limits together for slow/cold subprocesses.

Setup fails closed with `EngineSetupError` codes: invalid_catalog, not_found, permission,
authentication_required or connection_unavailable. Deadline/infrastructure exceptions may also
propagate. No model/tool dispatch occurs on failed discovery. The driver releases the lease and
leaves the run recoverable; P06 must map setup/auth errors to an actionable state/backoff rather
than repeatedly polling the same unauthorized connection. No silent empty-catalog fallback.

## Validation, approvals and evidence

Production validator uses pinned Ajv 8.17.1 and ajv-formats 3.0.1. Default dialect is 2020-12;
explicit draft-07 schemas are supported. No argument coercion, defaults, key removal, remote
schema fetch, async schemas or custom executable keywords. Unsupported/invalid schemas reject
the call before dispatch. Cache capacity defaults to 256; compilers and `$id` registries are
isolated per schema, so evicted definitions do not remain in a shared compiler registry.

Approval acceptance alone dispatches nothing. Persist the decision with authenticated scope,
then explicitly wake with the current run revision. The next worker rediscovers the catalog,
revalidates the stored call/policy and consumes its exact approval before invocation. Completed
calls are not replayed. Unknown effects require reconciliation, not an automatic retry.
See [durable driver](durable-driver.md) for immutable snapshots, fencing and crash boundaries.

Text, structured content, embedded resources and resource links remain evidence. Tool images
go inside Anthropic tool results. Chat Completions receives correlated text tool results followed
by a user image message **after the entire tool-result batch**. Private MCP `_meta` is excluded.
Audio remains stored; current adapters do not accept audio, so the loop returns structured
model failure before another provider call, retaining successful tool evidence without replay.
Provider-specific image media restrictions still apply; no automatic transcoding is provided.

`isError` is a failed call; fluent final text cannot override it. Timeout after send is unknown
and leads to partial outcome. Closing the engine aborts/yields active work and closes MCP sessions;
a fresh engine reconciles any persisted dispatch intent. Closing an HTTP connection must never
call `engine.close()` or pass its disconnect signal as worker shutdown.

## Boundaries and verification

P05-04 uses actual Anthropic/OpenAI SDKs over scripted fetch, actual HTTP/stdio MCP fixtures and
isolated PostgreSQL databases. No live key or external mutation is required. This verifies
composition and durability, not provider/model availability, intelligence or a Hermes/V4 win.
The engine owns MCP sessions; the host owns DB migrations/pool, model binding and auth policy.
HTTP/public event/action projection, daemon hosting, desktop and delegated agents remain later tasks.

Read [P05-04 handoff](handoffs/P05-04.md) before P06 work; its tests are executable examples.
