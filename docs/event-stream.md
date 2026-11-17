# Durable event stream

P06-02 implements `GET /api/v1/runs/{runId}/events` with authenticated SSE replay/follow.
The default HTTP factory now exposes all 12 v1 operations and advertises eventReplay true.
Use `stream: false` in EngineHttpOptions to disable the route and capability together.
Current migrations through **0010** are required; no migration is applied implicitly.

## Cursor and client recovery

- Encode opaque run IDs as one path component. Supply the same Bearer authentication used
  by other HTTP operations; actor/app/tenant never come from query/body claims.
- Optional query `cursor` or header `Last-Event-ID` resumes **after** its sequence. Both may
  be supplied only when identical. Unknown/duplicate query fields and malformed tokens fail.
- No cursor requests sequence 1 onward. Signed token binds version, event kind, owning scope,
  run, sequence and expiry. Future/noncanonical sequences and foreign page tokens are rejected.
- Owner lookup precedes token expiry/state disclosure. Foreign runs return NOT_FOUND; an
  expired cursor or unavailable/gapped beginning returns 410 EVENT_CURSOR_EXPIRED with
  recovery `{action: 'fetch_snapshot', runId}` before opening SSE.
- Fetch the run snapshot and recover final content/history as needed. Its lastEventSequence
  and eventCursor come from one consistent snapshot. Resume from that fresh cursor; do not
  restart a run/model/tool to repair a stream.
- Each durable frame has opaque cursor in `id`, contract event type in `event`, and one JSON
  DurableEvent in `data`. `eventId` and run+sequence are durable dedup identities. Cursor text
  can change on reissue because its expiry changes; it is not the dedup identity.
- Advance the saved cursor only after receiving/parsing/validating the complete frame and
  applying its event. Check contiguous sequences, dedup repeats and fetch snapshot on gaps.
  Network delivery does not establish application acknowledgement or exactly-once consumption.

Heartbeat/connected frames are comments without an ID or durable sequence. No ephemeral token
deltas are emitted by this implementation; MessageDelta remains an optional portable contract.
Durable message.completed/final content and GET history recover any omitted/lost transient text.
Terminal streams close after their high water is drained; waiting input/approval streams stay
open until disconnect, lifecycle limit, authorization failure or server shutdown. End-of-stream
without an expected terminal event is a reason to fetch a snapshot/reconnect with backoff.

## Public projection and atomic producers

Internal JsonObject event payloads are never spread into public data. A small application
projector builds the closed v1 envelope/payload and the HTTP boundary validates the schema and
UTF-8 bytes before serialization. References hydrate only same-run immutable messages, tool
bindings and approval snapshots in the same repeatable-read transaction as the event page.

| Event family | Source of historical facts |
| --- | --- |
| run state | Revision captured with the committed transition, fixed status semantics |
| step.started | Step index/correlation recorded with the step audit row |
| tool.started | Exact immutable MCP ref and captured attempt at dispatch intent |
| message.completed | Immutable public message referenced by ID |
| tool completed/failed | Paired immutable result message, exact call/step, explicit success/error/unknown |
| input required | Original question message + transition revision, not the latest conversation turn |
| approval required | Original proposal ID/revision, immutable args/binding, historical pending status |
| run completed | Confirmed final assistant message ID; unknown effects cannot produce completion |
| partial/failed | Fixed safe reason code/message; no raw provider/SQL diagnostic |

Approval-required events commit **with** the waiting transition, so immediate HTTP decisions
see an actionable state. A later accept/consume does not rewrite the earlier pending view.
Tool result messages and outcome events commit with journal settlement; restarted unknown calls
retain OUTCOME_UNKNOWN and never become a successful tool/run event. No duplicate generic
approval notification lacking its proposal is emitted. State/step/message writers remain fenced.

Private system instructions, SDK replay data, private MCP metadata, credential/endpoint config,
owner columns and raw diagnostics are excluded. Long content follows the existing bounded public
projection. An individual event exceeding eventBytes gives PAYLOAD_TOO_LARGE with snapshot
recovery before headers; it is not silently omitted. Incomplete pre-P06-02 event metadata may
require 410/snapshot fallback rather than invented historical facts. Old rows are not rewritten.

## Replay, retention and resource bounds

Database reads use owner-checked repeatable-read snapshots, bounded pages and a local 5s SQL
statement timeout. Replay never holds a transaction while waiting on the network. Per-read
lookback applies the advertised retention to occurredAt; actual deletion/retention jobs remain
P08. Missing prefixes/interior gaps cannot silently advance a cursor. Migration 0010 preserves
sequence allocation from the run's high water even after all retained log rows are pruned.

Default `EngineHttpOptions.stream` settings:

| Setting | Default |
| --- | --- |
| pollMs | 1000ms |
| heartbeatMs / authRefreshMs | 15000ms / 15000ms |
| writeTimeoutMs | 10000ms, including initial connected comment |
| maxStreamMs | 300000ms |
| maxStreams / maxStreamsPerScope | 64 / 8 per HTTP process |
| maxBufferedBytes | At least 1 MiB and eventBytes + 4096 framing bytes |
| batchSize | Up to 16, reduced to fit the configured event/buffer budget; hard max 64 |

Timer/capacity/buffer settings are trusted host options and validated on construction. Limits
bound process subscriptions, batches and queued transport bytes; no unbounded subscriber queue
or in-memory event store is introduced. Quota returns 429/retry_later. Reauthorization periodically
checks the original token and same principal before more data is sent; failure closes the stream.

Node write backpressure is awaited before another batch is read. Slow writes time out and
close without acknowledging unwritten data. On faults after headers, the server closes transport;
it does not inject an invalid JSON error/event into an already-open SSE response. The next request
can receive the normal typed JSON admission error and snapshot recovery action.

The connection AbortSignal controls only read/transport/timers. Closing a client/HTTP listener
does not request durable cancellation, stop a worker, or call a model/tool. Active SSE connections
are explicitly closed in Fastify preClose so listener shutdown does not wait for infinite streams.
SQL timeout is not cancellation of a pending pool connection; hosts must also configure sensible
database pool/network timeouts and capacity. Work/worker resources remain independently owned.

Fastify raw-response lifecycle is used explicitly: [Reply/hijack](https://fastify.dev/docs/v5.12.x/Reference/Reply/)
and [preClose hooks](https://fastify.dev/docs/latest/Reference/Hooks/). Raw event bodies are validated
before writing because hijacked responses bypass normal serialization.

See [P06-02 handoff](handoffs/P06-02.md), [review](reviews/P06-02.md) and the actual socket/MCP/
PostgreSQL tests. This does not claim live provider availability, hosted CI, production deployment,
token-by-token streaming or a V4/Hermes benchmark improvement. P06-04 provides
[headless client examples](headless-client.md) with read-only reconnect and snapshot fallback.
