# Standalone setup and operations

P08-03 provides a combined HTTP/worker host, a single-owner loopback starter and authenticated
health probes. No V4 install/data, desktop or Redis is required. This is a self-hosted engine;
production deployment and multi-user identity/secret provisioning remain host responsibilities.

## Fresh source checkout

Prerequisites: Node22.16.x/npm and a separate PostgreSQL database. PostgreSQL18 is the version
actually validated locally; other PostgreSQL versions have not been certified by this phase.
Run from the project root (PowerShell may use npm.cmd):

```text
npm ci --ignore-scripts --no-audit
npm run check
npm run build
```

Build compiles TypeScript and copies all13 migration SQL assets beside dist adapters. Ship the
whole dist directory, package metadata and installed runtime dependencies together. Never ship
only index.js. Missing/unreadable SQL now fails readiness; there is no ledger-only fallback.
P08-04 also pins the required schema version, so a missing final SQL suffix cannot certify an
older DB. When adding a migration, update ENGINE_SCHEMA_VERSION in src/bootstrap/schema-version.ts.
Commands below load only this project's optional .env; library factories never load it.

Create a NEW database through your PostgreSQL administrator. Example psql commands for a local
development role (choose its password interactively, never in shell history):

```sql
CREATE ROLE viper_local LOGIN;
\password viper_local
CREATE DATABASE viper_engine_dev OWNER viper_local;
```

The migration role must own/create the viper_engine schema in that new database. The migration
runner does not create PostgreSQL roles/databases. Never point these commands at an application
or V4 database. Production least-privilege roles, TLS and backup storage belong to the deployment.

## Configure and migrate

Copy .env.example to your own ignored .env and fill VIPER_DB_HOST/PORT/NAME/USER/PASSWORD/SSL.
Keep VIPER_HOST=127.0.0.1 for the local starter. It rejects a non-loopback listener.

Set VIPER_ACTOR_ID and VIPER_APP_ID to stable identities; changing them selects a different owner.
Generate two DIFFERENT random secrets, one for VIPER_LOCAL_TOKEN and one for VIPER_CURSOR_SECRET:

```text
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run that command twice and save each result privately in the corresponding variable. Neither is
a provider key. Keep the cursor secret stable across restarts so saved cursors remain valid;
rotating it invalidates outstanding cursors and requires clients to reload snapshots.

Choose the existing model adapter through VIPER_MODEL_PROVIDER. For Anthropic use its existing
ANTHROPIC_API_KEY/model settings; for OpenAI use its existing OPENAI_API_KEY and explicit
VIPER_OPENAI_MODEL. See .env.example and [composition](engine-composition.md). No guessed OpenAI
model, copied legacy environment, new credential provisioning or live credential test is performed.
Claude's cache usage support is retained; VIPER_MODEL_PROMPT_CACHE stays off by default.

```text
npm run db:migrate
npm run ops:check
npm run start:local
```

Migrate applies pending migrations under a transaction/advisory lock; rerunning is a no-op.
Current schema is0013,21 engine tables plus the migration ledger. Startup never auto-migrates.
ops:check is read-only, needs only DB configuration, and prints safe ready/code/schema metadata;
exit0 means schema compatible, exit1 means not ready. It does not test provider/MCP credentials.

start:local uses [standalone.ts](../examples/standalone.ts) and
[standalone-options.ts](../examples/standalone-options.ts). Startup validates configuration/schema,
binds HTTP, then starts worker claims. It logs only the listener address and safe failure guidance.
No model call happens merely because the process starts. Submitting a run can call the chosen provider.

## MCP and host customization

An empty VIPER_MCP_CONNECTION_IDS selects no tools: the starter can run model-only conversations.
Optional IDs must refer to EXISTING connections owned by the configured actor/app with no tenant.
The starter uses HTTP MCP without credentials and requires exact approval for every callable.
It denies API connection provisioning. It does not guess endpoints, create connections, run stdio
commands, or use a shared credential. Follow [MCP design](mcp-first-design.md) for managed provisioning.

For a private/OAuth MCP server or multi-user deployment, provide your own authenticate,
authorizeServer, connections, credentials and resolveEndpoint adapters to startEngineHost.
Keep owner scope on the server and preserve exact approval/catalog versions on resume. Do not
replace those adapters with a client-supplied identity or arbitrary command/endpoint.

startEngineHost(pool, options) owns its listener, worker and MCP sessions. The caller owns the pool
and migrations. It returns address, close(), done, readiness() and workerStatus(). close() is
idempotent; await it before pool.end(). A failed listen cleans up without claiming queued work.
runEngineHostUntilSignal explicitly installs/removes SIGINT/SIGTERM handlers. Imports do not listen.
For separate HTTP/worker processes use existing factories in [HTTP](http-api.md) and
[worker](worker-host.md), on the same compatible DB/model/policy configuration. Health routes here
describe the combined host only. Horizontal worker replicas use distinct worker IDs and DB leases.

## Health and readiness

Both GET /health/live and GET /health/ready require the same bearer authentication as /api/v1.
Configure your monitor with a valid host credential; unauthorized probes return401. Responses use
no-store and contain no connection string, credentials, owner, SQL error or tool/model payload.

| Probe | Successful response | Failure meaning |
| --- | --- | --- |
| /health/live | 200, status=alive | Listener/process or authentication unavailable |
| /health/ready | 200, ready=true, code=ready | 503 for schema/database/worker/draining state |

Readiness checks current schema checksums and local worker phase. Default probe deadline2000ms;
only one underlying DB check can remain outstanding, including after a timeout. A DB connection
acquisition is bounded at5000ms. A probe timeout is not proof the SQL query was cancelled.
Liveness stays200 during a DB outage/drift while the listener can respond. The authenticated
readiness route does not replace startup guards or report remote provider/MCP availability.

The API/events contract remains /api/v1; operational probes are additive host routes, outside its
OpenAPI operation list. They grant no new API or tool permissions. See [runbook](operations-runbook.md).

## Verification

Offline checks require no DB/key. Explicit PostgreSQL integration requires a loopback maintenance
role allowed to create/drop random viper_it_* databases; run npm run build first. See
[tooling](tooling.md). Tests never reuse the configured application DB.

The compiled operations smoke verifies empty DB refusal, all packaged migrations, migration
idempotency, occupied-port cleanup, queued work recovery, health authentication, live/readiness
separation under schema drift and graceful shutdown. Model responses are scripted; this is no
live model or Hermes/V4 performance claim. See [handoff](handoffs/P08-03.md) for actual evidence.
