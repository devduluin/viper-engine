# ADR-0001: Fresh engine schema and state contracts

Status: Proposed (P01-03), 16 November 2026, Asia/Jakarta. Specification R2.1.
Implements the logical model in [database design](../database-design.md); P04 builds it.

## Context

The engine needs durable conversations, runs, tool calls, approvals and events, with
compare-and-set revisions, scoped ownership and honest unknown outcomes. V4 persisted a different
domain (tools/knowledges/skills, intents, vector hints), and the owner decided against inheriting
it. P03 needs in-memory stores and P04 needs PostgreSQL, so both must follow one written rule set.

## Decision

1. **New schema `viper_engine`** in a database chosen by configuration. No V4 tables, foreign
   keys, IDs, migrations or connection strings. There is no import or compatibility layer.
2. **State rules live in code as pure contracts** in `src/contracts/state/`: status unions,
   transition tables, ownership, revision checks and reference appliers in `transitions.ts`.
   Store adapters must produce the same results as the appliers, but atomically.
   [State transitions](state-transitions.md) mirrors the tables, and a unit test fails if they drift.
3. **Ownership columns on every scoped row**: `actor_id`, `app_id`, `tenant_key`.
   Tenant-less deployments store `tenant_key = ''`. Empty is never a valid tenant ID, so it cannot
   collide, and unique constraints never depend on `NULL` semantics. Child rows carry the same
   owner columns and a composite foreign key to their parent `(id, actor_id, app_id, tenant_key)`.
4. **Another owner's row is `not_found`.** Ownership is checked first, before revision or status,
   so responses do not reveal whether an ID exists elsewhere.
5. **Revisions** start at 1 and increase by one per accepted write. A stale expected revision
   returns `revision_conflict` with the current revision; it is never merged.
6. **Tool-call ledger.** `dispatching` (dispatch intent) is committed before the external MCP
   call, and `attempts` increments on every dispatch.
   - Leaving `dispatching` again requires `known_not_applied` evidence (`retry_wait`).
   - `unknown` resolves only with `reconciliation` evidence.
   - No state returns to `ready`, so resume cannot redispatch a completed or uncertain call.
7. **Run settlement.** A run becomes terminal only when all its tool calls are settled.
   - `completed` refuses unknown outcomes. Those runs reconcile first or end as `partial`,
     `failed` or `cancelled`.
   - Terminal runs have no outgoing transitions, so late results cannot revive them.
   - Cancellation is a durable intent (`cancel_requested_at`) that the driver settles. It is not
     an immediate status jump that would orphan in-flight calls.
8. **Approvals.**
   - An approval binds run, tool call, `McpToolRef` (connection, server, name, definition
     version) and the SHA-256 digest of the canonical final arguments.
   - Changing any of these supersedes it.
   - Acceptance checks expiry. Consumption is single use and commits atomically with the tool
     call's move to `dispatching`.
9. **Events.** `run_events` has a gap-free sequence per run, starting at 1, written in the same
   transaction as the state change. Deltas are ephemeral and not stored.
10. **Bounded JSONB.** Content, arguments, outcomes and event payloads are validated JSONB with
   size limits. Large data is stored by reference.

## Consequences

- P03 in-memory stores and P04 repositories can share one behavioral test suite built on the
  appliers. P04 adds the concurrency, lease and crash-window tests.
- Leases/fencing (`lease_owner`, `lease_expires_at`, `lease_fence`) are reserved columns.
  Their semantics belong to P04-02, and the state contracts do not depend on them.
- Arbitrary remote tools still get no exactly-once guarantee. The schema only makes uncertainty
  visible and prevents automatic replay.
- Adding a status requires changing the union, the table, the mirror document and migrations
  together. The drift test enforces the first three.

## Rejected alternatives

| Alternative | Reason rejected |
| --- | --- |
| Reuse or extend the V4 schema | Owner decision; legacy taxonomy and intent tables are out of scope |
| Generic `resources` table with a category column | Recreates the tools/knowledges/skills taxonomy |
| Nullable `tenant_id` in unique keys | Default NULL semantics break deduplication across deployments |
| Status-only cancel (`running -> cancelled`) | Orphans in-flight dispatches and hides unknown outcomes |
| Retry by resetting a call to `ready` | Enables silent redispatch of uncertain writes |
| Vector/embedding tables in the initial schema | Not needed for the loop; P07 starts from basic DB search |

Tables, columns and indexes: [schema tables](tables.md).
