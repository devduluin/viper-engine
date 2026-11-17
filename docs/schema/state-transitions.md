# State transitions

Mirror of `src/contracts/state/*-state.ts`. The test `tests/unit/state/spec-sync.test.ts` parses
the tables below and fails on any drift. `(evidence)` marks a transition that needs that
`ToolCallEvidence`. "terminal" means there are no outgoing transitions.
Decision record: [ADR-0001](ADR-0001-fresh-schema.md).

## Run transitions

| From | To |
| --- | --- |
| `queued` | `running`, `cancelled` |
| `running` | `waiting_for_input`, `waiting_for_approval`, `completed`, `partial`, `failed`, `cancelled` |
| `waiting_for_input` | `running`, `failed`, `cancelled` |
| `waiting_for_approval` | `running`, `failed`, `cancelled` |
| `completed` | terminal |
| `partial` | terminal |
| `failed` | terminal |
| `cancelled` | terminal |

Settlement rule for any terminal target:
- Every tool call must be `succeeded`, `failed`, `rejected`, `cancelled` or `unknown`.
- `completed` additionally requires that no tool call is `unknown`.
- Cancellation is first recorded as intent (`cancel_requested_at`, idempotent, needs no revision).

## Tool call transitions

| From | To |
| --- | --- |
| `proposed` | `awaiting_approval`, `ready`, `rejected`, `cancelled` |
| `awaiting_approval` | `ready`, `rejected`, `cancelled` |
| `ready` | `dispatching`, `cancelled` |
| `dispatching` | `succeeded`, `failed`, `unknown`, `retry_wait` (known_not_applied) |
| `retry_wait` | `dispatching`, `failed`, `cancelled` |
| `unknown` | `succeeded` (reconciliation), `failed` (reconciliation) |
| `succeeded` | terminal |
| `failed` | terminal |
| `rejected` | terminal |
| `cancelled` | terminal |

Additional rules:
- A call with `requires_approval` cannot go `proposed -> ready`; it must pass `awaiting_approval`.
- Every move into `dispatching` increments `attempts`.
- A run cancelled while a call is `dispatching` records that call's outcome (often `unknown`),
  never `cancelled`.

## Approval transitions

| From | To |
| --- | --- |
| `pending` | `accepted`, `rejected`, `expired`, `superseded` |
| `accepted` | `consumed`, `expired`, `superseded` |
| `rejected` | terminal |
| `expired` | terminal |
| `superseded` | terminal |
| `consumed` | terminal |

Additional rules:
- Accepting at or after `expires_at` yields `approval_expired`.
- Consumption requires `accepted`, an unexpired approval, and an exact binding match (run,
  tool call, connection, server, tool name, definition version, arguments digest).
- Consumption commits together with the tool call's `dispatching` transition.

## Conflict codes and check order

Every applier checks, in this order: ownership (`not_found`), revision (`revision_conflict`),
transition (`invalid_transition` / `evidence_required`), then domain rules
(`unresolved_tool_calls`, `approval_expired`, `approval_mismatch`).
Event appends that do not follow `last + 1` fail with `sequence_conflict`.
