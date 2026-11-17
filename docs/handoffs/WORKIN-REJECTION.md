# Workin follow-up: user-declined approval

Status: DONE (offline/integration verified), Codex, 17 November 2026. Separate corrective slice;
does not add a task to the 36-task DAG. P07-02 remains dependency-ready, not started here.
Source finding: [WORKIN-LIVE](WORKIN-LIVE.md), item 1; [triage](../reviews/WORKIN-LIVE.md).

## Result

A matching server-owned approval with rejected status now yields tool result JSON:

```json
{
  "status": "not_dispatched",
  "error": {
    "code": "rejected_by_user",
    "message": "The user declined this action. It was not executed. Do not retry it or request broader access to bypass this decision."
  }
}
```

This is host planning evidence. It is distinct from permission/authentication/transport errors
returned by MCP. The normalized MCP failure-code set is unchanged and rejects this host-only code.
The next model request receives this evidence; no claim about a live model's final wording is made.

Explicit decline binds actor/app/tenant, run, call, tool connection/server/name/version and final
argument digest. Expired/superseded/pending/accepted/consumed or mismatched approvals cannot be
presented as user rejection. Current host policy denial retains permission semantics.

An exact user rejection remains blocking if host policy subsequently changes to execute, including
when the proposal was originally recorded without requiresApproval and approval became required
before dispatch. Rejected in-memory decisions do not expire into another approval wait; active
accepted/pending expiry and original run deadline still apply. No permission grant or retry added.

## Paths and compatibility

- `contracts/state/tool-rejection.ts`: host ToolFailureCode/ToolRejection, strict report-code parser,
  exact owner/binding check. Existing P01 checks and P02 fingerprint reuse; no legacy source copy.
- `agent/execution`: optional trusted policy.rejection explanation is consulted only after reject,
  after catalog/argument validation. It cannot change admission. Final before-invoke guard stays
  restricted to MCP failure codes. Tool result/report retains the host reason.
- `application/durable/approval-policy.ts`: extracted focused policy/binding component from
  tool-commands, used by planning and dispatch guards; sticky exact rejection and safe explanation.
- `application/runs/session-policy.ts`: same evidence for in-memory resume; current policy precedence.
- `application/durable/state.ts`: validates/restores host-only code only for rejected reports.
  Legacy permission reports remain readable. Existing historical messages are not rewritten.

HTTP requests/routes/statuses, public API error-code enum, SSE event types, database migrations,
MCP parser and grants remain unchanged. Existing tool-result JSON carries the new code; generic
tool.failed summaries still direct consumers to the result message. No new dependency/table.

Runtime checkpoint shape stays v1 but gains a possible host report code. Older worker binaries
with the old closed decoder cannot resume such reports: upgrade workers together and consider this
when rolling back. No production rollout/migration was performed by this task.

## Validation

- npm.cmd run check: **265 unit + 143 contract = 408 PASS**, zero failures/skips. Type/lint/
  architecture/docs/fixture gates pass, with original source300/runtime180/function60/complexity10.
- Explicit isolated PostgreSQL runner: **148/148 PASS** (three new cases plus previous 145).
  Actual HTTP reject/new engine/Anthropic SDK scripted fetch receives user-declined JSON; MCP
  fixture observes zero calls/effects and zero ledger attempts. Later permissive policy stays denied.
- OS-kill after atomic rejection/result commit restores the new report code, produces exactly
  one tool result, and neither dispatches nor duplicates the action. Mixed in-memory approval batch,
  unchanged policy denial, terminal rejection after TTL, binding/scope mismatch and validation order tested.
- Build/OpenAPI and compiled public context/client/HTTP/SSE/worker/engine smokes pass.

Only generated viper_it_* databases on the isolated review cluster; cluster stopped afterward.
No .env/key access, live model or Workin gateway, seed/cleanup, application/V4 DB or deployment.
WL-001/WL-014 live rerun remains pending. Other Workin findings remain triaged, not silently closed.

## Next

Prioritize MCP expired-session 404 handling and resources/read -32002 mapping with protocol failure
fixtures. A fresh authorized session can serve later operations; never automatically replay a
possibly dispatched write. Host instruction wiring and per-run setup diagnostics also remain.
