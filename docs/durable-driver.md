# Durable run driver

Entry: `src/bootstrap/durable.ts` exports createDurableRunDriver(pool, dependencies).
It composes PostgreSQL lease/run/checkpoint/journal adapters with the existing core loop.
No HTTP, desktop or provider-specific dependency enters the application driver.

## Host responsibilities

- The journal was introduced in 0007; current stack requires migrations through 0010
  on the explicitly configured engine database. No implicit migration is performed.
- Supply model and MCP gateways, schema validator, current policy, Clock, globally unique IDs,
  provider label and configure(scope, checkpoint). The scope is rebuilt from the claimed owner.
- configure refreshes authorized RuntimeTools and instructions. Initial model/ceilings/deadline
  are stored; a restart cannot replace them with higher host defaults.
- Call driver.runOnce(workerId, optionalWorkerShutdownSignal). Results are idle, yielded or settled.
  The host controls polling/backoff/concurrency; P06-03 provides [the worker host](worker-host.md).
- Closing a client connection must not pass its disconnect signal as worker shutdown or request
  cancellation. User cancel uses RunStore.requestCancellation with authenticated scope.
- Own/close the SQL pool and shared MCP resources at host shutdown. runOnce closes its timers,
  listeners and lease; it does not own shared provider clients or the database pool.

## Atomic boundaries

RunJournal uses an existing transaction when composing the reviewed repositories. It checks the
lease and checkpoint revision under the run update lock, then locks the conversation. Commands
and the versioned state commit together or all roll back. There is no in-memory lock fallback.

| Boundary | Durable evidence before proceeding |
| --- | --- |
| Model start | Step/model attempt and charged counters |
| Assistant decision | Message, exact tool proposals, budget reservations and execution phase |
| Tool dispatch | Ready/approval consumption, dispatch intent/attempt and current checkpoint |
| Tool report | Outcome, paired result message, report/budgets and events |
| Batch completion | Correction accounting and next phase |
| Pause/terminal | Settled unanswered calls if terminal, state, run transition and event |

History is append-only. A result saved at report time is ignored when the core later emits the
same message-appended notification; the normal path does not duplicate it.

## Recovery and wake

- Missing model result: keep the attempt charged, record unavailable usage and unknown failure;
  a further model attempt consumes another allowance.
- In-flight tool: record unknown, answer outstanding calls without sending more tools, end partial
  (or cancelled when requested). Never guess success or repeat an uncertain external action.
- Confirmed result: use its persisted output. Never replay the completed call.
- Final answer committed before crash: finish from stored evidence without asking the model again.
- Input/approval pause: retain counters, fingerprints and absolute deadline. Persist user input or
  approval decision through authenticated use cases, then RunStore.wake with the current revision.
  Acceptance alone dispatches nothing. A new lease holder resumes only unanswered work.
  Rejected exact proposals return rejected_by_user/not_dispatched evidence, surviving policy changes
  and restart without dispatch. See [rejection follow-up](handoffs/WORKIN-REJECTION.md).
- Amended proposal: immutable new IDs/arguments are materialized as a new assistant call after
  answering the superseded call; current catalog/schema/policy and accepted binding still apply.
- Graceful worker shutdown/lost renewal: abort local work and yield. In-flight effects may remain
  unknown for the next holder. A stale worker cannot commit late messages/results.

Checkpoint history defaults to 10000 messages/ledger records, with a configured ceiling of 100000.
The stored execution state is limited to 2 MiB. Oversized/unsupported snapshots fail closed;
[P07 context compression](context-budgeting.md) bounds model view; physical retention/operations
remain P08 work and do not remove canonical recovery evidence.

## Validation and integration

`npm run check` stays offline. PostgreSQL suites use explicit VIPER_TEST_DB_* settings and generated
viper_it_* databases. Invoke `node scripts/run-tests.mjs integration` when .env loading is unwanted.
Four restart tests fork and kill fixture workers; they use no real model/MCP credentials.

See [P04-04 review](reviews/P04-04.md) for exact evidence and limitations, and
[handoff](handoffs/P04-04.md) for ownership and next-task instructions.
