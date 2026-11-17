# Engine API and event contract

Revision R2.1. P01-04 schemas and all 12 P06 HTTP/SSE operations are implemented.
API is client-neutral and independent from Next.js/Electron/Tauri. Desktop extensions are deferred.
Executable schema source: `src/contracts/api/`; [schema guide](api/README.md) defines exact body,
cursor, replay and compatibility rules. `npm run api:export` writes the OpenAPI JSON artifact.

## Version and identity

Engine has its own host/port and `/api/v1` namespace. This is not a compatibility promise for
V4 endpoints. OpenAPI/JSON Schema describe payloads, validation and versioning.
Auth adapter resolves trusted actor/app/optional tenant; client body cannot override identity.
Every resource lookup checks conversation/run/connection ownership.

## Initial endpoint targets

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/capabilities` | Protocol version, engine features, deployment limits |
| `POST /api/v1/conversations` | Create scoped conversation |
| `GET /api/v1/conversations/{id}` | Conversation snapshot/history references |
| `POST /api/v1/conversations/{id}/runs` | Idempotent start; `202` + run reference |
| `GET /api/v1/runs/{id}` | State/revision/progress and consistent event cursor |
| `POST /api/v1/runs/{id}/inputs` | Continue expected run/revision with clarification input |
| `POST /api/v1/runs/{id}/cancel` | Persist cancellation intent, idempotent |
| `GET /api/v1/runs/{id}/events` | Scoped SSE stream with replay and heartbeat |
| `POST /api/v1/approvals/{id}/decision` | Accept/reject exact immutable proposal |
| `POST /api/v1/mcp/connections` | Connect authorized operator-configured serverId; no client secrets/commands |
| `GET /api/v1/mcp/connections` | Connection availability without secret values |
| `POST /api/v1/mcp/connections/{id}/disconnect` | Revoke/invalidate future dispatch |

OAuth flows/config updates get explicit contracts in P05/P06 if chosen servers need them;
never accept arbitrary credentials/commands from model output. Resources/prompts can be selected
through run input/application contract; they do not require legacy knowledge/skill CRUD endpoints.
No device/pairing/companion/desktop endpoints are included now.

## Idempotency and revision

Create-run `Idempotency-Key` is scoped principal + operation and bound to canonical payload.
Same key/payload returns original run; changed payload -> `409 IDEMPOTENCY_CONFLICT`.
Default retention target 24h; advertise configured retention, do not assume indefinite dedup.
Clarification input includes `inputId` and expected revision; approvals include proposal reference
and expected snapshot/revision. Stale data -> `409 REVISION_CONFLICT`.

Request retry does not generate a new action identity. HTTP disconnect is not run cancellation.
Long-running work survives clients closing once durable driver is enabled.

## Event envelope

Required: `schemaVersion`, `eventId`, `sequence`, `conversationId`, `runId`, `occurredAt`,
`type`, `payload`; `stepId`, `modelCallId`, `toolCallId` where relevant.
Durable event sequence is monotonic per run and transactionally consistent with state changes.

Events: `run.queued`, `run.started`, `step.started`, `tool.started`, `tool.completed`,
`tool.failed`, `run.input_required`, `approval.required`, `message.completed`,
`run.completed`, `run.partial`, `run.failed`, `run.cancelled`.
`message.delta` and transient status may be ephemeral; final message persists separately.
No desktop event types are required now.

Replay delivery is at-least-once; clients dedup event IDs/sequence. Accept Last-Event-ID/cursor;
expired cursor -> `410 EVENT_CURSOR_EXPIRED`. Fetch snapshot+cursor then reopen stream.
Initial replay retention target 7 days, configurable. Cursor and snapshot must be consistent.
Reconnect must not create new run/model/tool calls. Token delta loss is repaired by reading
persisted final content, not by rerunning the model.

Use bounded buffers/heartbeats; detach slow consumers without stopping durable execution.
Support Authorization via fetch-streaming client or reviewed cookie/CSRF flow; do not place
bearer secrets in URLs. Polling run snapshot remains possible without a generated SDK.

## Errors and payloads

Stable error envelope: code, safe message, requestId, retryable, recovery metadata when relevant.
Examples: `ACCESS_DENIED`, `REVISION_CONFLICT`, `CONNECTION_UNAVAILABLE`, `APPROVAL_REQUIRED`,
`BUDGET_EXCEEDED`, `OUTCOME_UNKNOWN`. Do not expose secrets/raw SDK errors to clients.
Structured MCP content stays bounded; large output requires a scoped reference/optional artifact
adapter, not unbounded base64/event payloads.

## Compatibility and tests

P06-04 adds optional RunSnapshot.usage: audit attempt count, provider/estimate/mixed/unavailable
source and nullable input/output/total aggregates. Unknown fields stay null, no monetary estimate.
Read [headless client](headless-client.md) for exact semantics, input/approval and bounded reconnect.
P07-01 adds optional RunSnapshot.context with latest committed context counters/estimate flags;
zero omitted messages is valid. Excerpt/digest remains private. See [context guide](context-budgeting.md).

Additive changes within v1; breaking semantic changes require versioning. P06 tests headless
clients against API/events schemas. A future desktop SDK can consume these same contracts;
no desktop build or companion implementation is required to pass engine release.
