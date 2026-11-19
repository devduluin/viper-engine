# HTTP API host

P06-01 implements the 11 non-streaming v1 operations with Fastify 5.12.8. The portable
[API contract](api-contract.md) remains authoritative. P06-02 adds the 12th [SSE/replay](event-stream.md)
operation; eventReplay is true by default (stream:false disables it). No automatic worker or listener starts on import.

## Composition

`createEngineHttpServer(pool, options)` returns a Fastify instance. Apply migrations through
**0011** to the explicitly configured engine DB first. Host owns listening, DB pool and workers.
The factory never loads `.env`, provisions operator servers, creates credentials or uses V4 data.
HTTP controls began in 0008, worker admission in 0009 and the replay-safe append guard in 0010.

```ts
import {
  createEngineHttpServer, createViperEngine, persistedRunInstructions,
} from 'viper-engine';

const http = createEngineHttpServer(pool, {
  cursorSecret: deploymentCursorSecret, // Stable >=32 bytes; not an API/provider token.
  authenticate: bearerToken => authAdapter.authenticate(bearerToken),
  authorizeServer: (scope, serverId) => accessPolicy.authorizeServer(scope, serverId),
  prepareContext: (scope, selection) => contextAdapter.prepare(scope, selection),
  authorizeMedia: (scope, source) => mediaPolicy.authorize(scope, source),
});
const engine = createViperEngine(pool, {
  ...trustedEngineOptions,
  instructions: persistedRunInstructions(pool),
});
await http.listen({ host: '127.0.0.1', port: 3000 });
// A separate worker host calls engine.runOnce; no HTTP handler executes the model/tool loop.
// On host shutdown: await http.close(); await engine.close(); await pool.end();
```

The host supplies the named bindings above; these are not permissive built-in implementations.
If using global instructions too, combine them with the saved per-run instructions in the
trusted worker callback. No HTTP client can inject a system role/history, scope or execution budget.

## Authentication and configured access

All operations require one Bearer header. `authenticate(token)` returns an authenticated
actor/app/optional tenant identity or undefined; only then is TrustedScope constructed. It must
verify tokens with the deployment's identity provider. No body/header actor fallback, cookies,
shared development identity or trusted proxy is enabled by default. Request IDs are server-generated.
Logging defaults off so bearer/body/SQL data is not accidentally logged; operations logging is P08.

`authorizeServer(scope, serverId)` must return false, ready or authentication_required. A grant
is followed by an independent database check of app/tenant/private owner/enabled. It creates
only a per-owner connection to an operator-configured server. It never accepts transport URLs,
commands, OAuth tokens or secret refs from request JSON. Initial ready requires a real host grant.
Disconnect checks revision, persists revocation and invalidates future MCP admission. Already
revoked with the current revision is a no-op; an in-flight remote effect cannot be undone.

Context resource/prompt selections first check owned ready/enabled connections in the directory.
Optional `prepareContext` then performs read-only, bounded application-controlled preparation:
verify advertised URI/prompt, capability and content policy using authorized MCP ports; return
trusted system messages that frame external material as data. No implicit URL fetch or default
resource/prompt policy. Without the hook, nonempty context is rejected and capabilities advertise
resources/prompts false. Prepared instructions are saved privately and consumed through
persistedRunInstructions; they are excluded from public conversation/run responses.

Reference image/audio sources also require the optional owner-aware `authorizeMedia` grant;
without it they are denied. This hook checks authorized media access, not arbitrary URI syntax.
Inline media remains schema/byte bounded. Hooks do not execute model/tool actions; authentication,
grant, media and preparation callbacks are bounded to 10s. Context/media preparation occurs in
the atomic command transaction and must remain short/read-only. Unknown hook/infrastructure
errors produce safe INTERNAL_ERROR; hosts may throw ApiFailure for a known actionable refusal.

## Atomic control-plane commands

| Command | Transactional behavior |
| --- | --- |
| Create conversation | Server ID + owner/title/timestamps; no model invocation |
| Start run | Owner check, resource-scoped idempotency, active-run check, queue, initial user message, private instructions and dedup completion commit together |
| Submit input | Lock run, check input receipt before stale revision, verify waiting state, append user input, wake/fence and save original acceptance together |
| Approval decision | Owner/revision/exact binding/expiry check, decision and explicit wake together; wait until no unexpired pending proposals remain |
| Cancel | Idempotent durable intent; response can remain running until worker settles effects |
| Connection create/revoke | Host grant + owner predicates, single live binding and revision CAS |

Only one active run per conversation is admitted by the HTTP surface. Start returns 202 without
claiming it. Caller key is printable ASCII 1-128 chars; storage binds owner/operation/resource
and canonical body. Same key/body returns the original run reference even when terminal; changed
body conflicts. Failed creation rolls back its dedup claim. Resource IDs are URL-encoded opaque
components, including slash/Unicode and full 256-character IDs.

Clarification receipts persist the original accepted response: retries after wake/completion
return it even with the original stale revision. Changed body with the same inputId conflicts.
Approval retry with stale revision returns REVISION_CONFLICT/currentRevision. Decision acceptance
never invokes MCP; the next worker revalidates and atomically consumes the stored binding.
Rejected tools remain explicitly rejected, with error result evidence and no remote side effect;
the existing loop may complete a truthful final response after a rejection.

Closing a client or HTTP server does not cancel a run or stop an engine. No request-disconnect
AbortSignal reaches worker execution. Actual socket-disconnect integration verifies the command
can commit and a separately invoked worker can complete after the HTTP server closes.

## Snapshots, cursors and bounds

Conversation pages and run snapshots use one database snapshot. Public projections allowlist
fields: no owner columns, private system messages, endpoints, credentials, SDK errors or private
MCP metadata. Outputs are validated against the same v1 schemas before serialization.

Long text is split into <=65536 UTF-16-unit blocks without breaking surrogate pairs. Above 32
content blocks, the last JSON block carries `{type: 'content_overflow', blocks: [...]}` so evidence
remains available. This is JSON data, not executable authority. Other provider/core output outside
v1 wire bounds fails closed; hosts should retain the default <=32 tool proposals per batch.

`GET /api/v1/conversations` lists the caller's conversation summaries (id, title, revision,
messageCount, createdAt, updatedAt; never message content), newest activity first, keyset-paged on
`(updatedAt, id)` with the `conversations` cursor kind (default 50 per page). Conversations without
messages are omitted, so a conversation created before a failed start does not appear in history.
`POST /api/v1/conversations/{id}/delete` is a soft delete (migration 0014 `deleted_at`): the conversation
leaves the list, reads and new runs answer 404, while runs, tool calls, approvals and events are kept for
audit. Idempotent; `INVALID_STATE` (409) while a run is active; another owner gets 404.

`StartRun.options.effort` (`low` | `medium` | `high`, optional) is stored on the run (migration 0015) and
used for that run's Anthropic model calls when the host passes `runEffortFromDatabase(pool)` to
`createConfiguredModelBinding`; absent = the configured `VIPER_MODEL_EFFORT`. OpenAI keeps its own setting.

`POST /api/v1/conversations/{id}/title` renames with `{title}`; with an empty body it asks the host's
`titleConversation` hook (e.g. `createModelTitler(model)`) for a 2-6 word title from the first question and
answer (15 s deadline, outside transactions, not a run model call). Without a hook an empty body is 400.

Run SSE streams also carry provisional `message.delta` frames (no `id`, never replayed, process-local):
the configured model gateway publishes `text_delta` to an in-process bus; `message.completed` stays final.

Signed opaque cursors bind version/kind/owner/app/tenant/resource/position/expiry. Page and event
tokens are distinct. Use a stable deployment secret across restarts; key changes invalidate old
cursors. Event expiry gives 410/fetch_snapshot; invalid/foreign page cursors give 400. Event token
verification/future-sequence admission and actual SSE replay are implemented by [P06-02](event-stream.md).

Defaults: requestBytes/eventBytes 262144, idempotency/event retention target 86400 seconds,
page size 100 (limit 1-100), JSON depth 32, schema ceiling request/event bytes 1 MiB. Fastify bounds
request bytes before parsing ([parser documentation](https://fastify.dev/docs/latest/Reference/ContentTypeParser/));
input aggregate is additionally bounded for message storage.
Retention cleanup, rate limiting, deployment hardening and payload/artifact storage remain P08.
No production deployment or live-provider compatibility claim is made by local integration tests.

## Next work

Read [P06-01 handoff](handoffs/P06-01.md) and [review](reviews/P06-01.md).
P06-03 [worker host](worker-host.md) provides polling/concurrency, durable setup/auth backoff,
expired-approval wake and shutdown. P06-02 [SSE/replay](event-stream.md) and P06-04
[headless examples](headless-client.md) are complete. RunSnapshot optionally exposes usage from
audit attempts; unknown token fields remain null. [Context budgeting](context-budgeting.md) and
[scoped recall](scoped-recall.md) are complete; recall CRUD is a host-library service, not new HTTP routes.
