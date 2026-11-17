# API v1 schema guide

P01-04 defines portable contract data. P06-01 implements 11 non-streaming HTTP operations;
P06-02 adds durable SSE/replay. Read [HTTP guide](../http-api.md), [stream guide](../event-stream.md), [API semantics](../api-contract.md)
and [P01-04 handoff](../handoffs/P01-04.md) before extending handlers.

## Source and export

- `src/contracts/api/schemas.ts`: frozen JSON Schema 2020-12 document; named schemas under `$defs`.
- `src/contracts/api/openapi.ts`: frozen OpenAPI 3.1.1 document for 12 operations across 11 paths.
- `content`, `requests`, `responses`, `errors`, `events`: separate schema responsibilities.
- `run-paths`, `resource-paths`, `operations`: route metadata and HTTP schema references.
- `npm run api:export` builds source, then writes `artifacts/openapi/v1.json`. The artifact is
  reproducible and gitignored; edit source modules. No server starts and no credentials are read.
- Framework-neutral source contains no validator/SDK. P06 composes a validator and HTTP adapter.

OpenAPI 3.1 supports JSON Schema 2020-12; see the
[official specification](https://spec.openapis.org/oas/v3.1.1.html). Local schema references are
converted from `$defs` to OpenAPI components by the exporter, with no remote references.

## Mutation and authority boundaries

All operations inherit bearer authentication. The auth adapter decides how to verify tokens;
the document does not mandate JWT claims or invent a user identity from body JSON.
Foreign resource IDs resolve as NOT_FOUND before revision/status details are exposed.
IDs remain opaque; clients encode each ID as one URL path component, including reserved characters.

| Operation | Required body/condition |
| --- | --- |
| Create conversation | Empty object or bounded title |
| Start run | UserInput; mandatory Idempotency-Key header, scoped to operation/resource/owner |
| Submit clarification | inputId dedup token, expectedRevision, UserInput |
| Cancel | Empty object; durable idempotent intent; 202 snapshot can still be running |
| Decide approval | expectedRevision, exact proposal binding, accept/reject; no replacement args |
| Create connection | Authorized operator-configured serverId only |
| Disconnect | expectedRevision; repeat with current revision is a no-op when already revoked |

UserInput has content blocks, never role/history/tool calls/authority/budget. Context selections
reference authorized connections/resources/prompts; prompt arguments are strings. Selection never
permits an arbitrary URI fetch. P05/P06 recheck access, readiness and resource policies.

Connection payloads expose no endpoint configuration, stdio command, secret values or secret
references. Operator provisioning and OAuth flows are separate future adapter contracts.
Approval body binding is only a comparison with stored server state. P04 still checks scope,
revision, expiry, access and atomic single-use consumption immediately before dispatch.
ApprovalView includes the concrete final `arguments` object so a user can review the action,
alongside its immutable binding/digest. P03-04 refined this pre-release output contract before
P06 endpoints exist; producer fixtures/export were updated together. Request args remain immutable.

## Deduplication and revisions

- Idempotency-Key is printable ASCII, 1-128 chars; never a credential or execution permit.
- Bind owner actor/app/tenant + method + operation + path resource + canonical body fingerprint.
  Same key/body returns the original run reference, including if that run is now terminal.
  Changed body returns 409 IDEMPOTENCY_CONFLICT. Do not create a second model/tool identity.
- inputId is a client-generated dedup token, not a server entity ID. Same inputId/body returns
  its original acceptance; changed content conflicts. Check dedup before stale revision on retries.
- Revisions and event sequences are safe integers. Invalid shape -> 400 INVALID_REQUEST;
  stale valid revision -> 409 REVISION_CONFLICT with currentRevision/recovery action.
- Approval decision retries do not execute a tool; stale decisions return a conflict. Actual
  consumption is the server's atomic workflow, not an API field or a model-generated decision.
- Retention is deployment-configured and advertised in capabilities; 24h idempotency is a target.
  Retrying outside retention may create a new run and must be an explicit client action.

## Replay and messages

- Durable events have schemaVersion=1, ID, sequence>=1, time, conversation/run and typed payload.
  Step/tool events require matching correlation IDs. Internal event records are projected and
  validated against these payload schemas before emission; arbitrary JsonObject is not public data.
- `tool.failed` distinguishes error/unknown; unknown uses OUTCOME_UNKNOWN. No successful completion
  event may hide an uncertain execution. Empty successful tool output remains valid.
- Public messages include user/assistant/tool only. Private system instructions, SDK errors and
  private MCP metadata are never serialized. Build an allowlisted projection, not object spread.
- `message.delta` has no eventId/sequence/cursor; it cannot acknowledge durable replay. Heartbeats
  are SSE comments and do not advance a cursor.
- SSE frame `id` contains an opaque EventCursor; envelope eventId is the dedup identity, a distinct
  value. Last-Event-ID or query cursor can resume. If both are supplied they must match, else 400.
- No cursor means replay available events from the start. An expired/unavailable beginning returns
  410 EVENT_CURSOR_EXPIRED, with fetch_snapshot recovery, rather than silently dropping history.
- Snapshot state/lastEventSequence/eventCursor come from one consistent read. Replay is after
  that cursor; dedup delivery by run+sequence/eventId. Closing the stream does not cancel the run.
- Cursor encoding is private to the server. Check signature/lookup, version, owner, run/resource,
  expiry and future sequence before use. Valid characters are not authorization. PageCursor is
  a different semantic token; it must never be accepted as an event cursor merely by shape.
- Recover lost deltas from final message/history. Reconnect never causes a model/tool call.

## Bounds, compatibility and validation

Per-field limits include 32 content blocks, 64Ki text characters and 256Ki base64 characters.
Request/event aggregate byte ceilings are configured and advertised (schema upper ceiling 1MiB).
P06 must enforce bytes before parsing, JSON depth, message pairing/IDs, state and scope checks;
schema validation alone cannot implement these. Reference media is not fetched by a schema.

Within v1, add optional fields and new separately negotiated capability/event types. Keep existing
field meaning, required fields and error semantics. Removing/renaming fields, narrowing accepted
input, adding required input or changing cursor semantics needs a new version or explicit migration.
Current server request/output schemas are closed to reject typos and accidental private fields;
clients must tolerate future optional response fields and preserve their durable cursor when safely
skipping unknown version-compatible events. Do not validate future output with an archived closed schema.
New required event semantics require capability/version agreement; unknown events cannot trigger actions.
Unknown error codes remain failures; clients must not infer success or repeat remote actions from them.

Tests cover request/response/event fixtures, negative authority cases, limits, error recovery,
local reference resolution and official structural OpenAPI validation with an invalid-document case.
All checks run offline after install. External schema provenance and validator adaptation are in
[fixture notice](../../tests/fixtures/api/NOTICE.md). No HTTP, auth, durable store or cursor codec
implementation is claimed by P01-04.
