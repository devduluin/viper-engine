# Workin MCP session and resource follow-up

Status: DONE, Codex, 17 November 2026. Separate adapter correction, not a new DAG task.

- Streamable HTTP 404 now retires the initialized session synchronously and invalidates catalog;
  next acquire rechecks owner/directory/credentials and initializes a fresh session. Failed request
  is returned to caller; no automatic tools/call replay or immediate credential relaxation.
- Resources/read JSON-RPC -32002 maps to sanitized not_found only at that method boundary.
  Healthy session stays live. Arbitrary tools/call error codes are not reclassified as resource errors.
- Three real SDK/HTTP fixture cases prove fresh connection on later operation, no repeated effect,
  exact credential re-resolution and safe missing-resource diagnostic. Existing pool/race tests retained.

Primary references: [MCP session management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management)
requires fresh initialization after an unknown session; [resource errors](https://modelcontextprotocol.io/specification/2025-11-25/server/resources#error-handling)
defines resource not found. Pinned SDK behavior and actual transport errors were inspected locally.

Source: adapters/mcp/client/gateway.ts and context-reads.ts. No wire contract/dependency/migration
change. HTTP404 classification existed already; correction fixes stale session reuse. Refusal after
send is still classified by current protocol contract, unknown effects never silently retried.

Combined P07-02 offline/integration/build evidence is in [progress](../progress.md). Workin live
WL-001/WL-014 revalidation, host date/timezone wiring and per-run setup diagnostics remain pending.
