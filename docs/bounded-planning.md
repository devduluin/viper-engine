# Bounded advisory planning

P07-04 adds `createPlanEvidence(binding, plan)`: an experimental, explicitly installed
`ContextEvidenceProvider` for a small host-authored checklist. **Default off.** No automatic
planner/model call or mandatory planning stage is added to the simple loop.

The paired [ablation report](reports/P07-04-ablation.md) measures deterministic preservation and
context overhead. Live semantic benefit is NOT MEASURED. Keep normal workloads on the baseline;
host-specific rollout needs paired real-model quality/usage evidence first.

## Host usage

```ts
const planEvidence = createPlanEvidence({ scope, conversationId, runId }, {
  schemaVersion: 1, planId: 'request-checklist', revision: 1,
  objective: 'Read the requested record and report what was observed.',
  steps: [
    { id: 'read', goal: 'Inspect the requested record.',
      evidence: 'Current authorized MCP read result.', dependsOn: [] },
    { id: 'answer', goal: 'Return the value and any uncertainty.',
      evidence: 'Successful observed result, or explicit error/unknown.', dependsOn: ['read'] },
  ],
});
// Only the host-selected run receives this checklist; other runs receive no plan evidence.
const engine = createViperEngine(pool, { ...options, contextEvidence: planEvidence });
```

Resolve `scope` through host authentication and obtain actual conversation/run IDs first.
The engine installs no provider when the host omits `contextEvidence`. The factory creates a
provider only; it opens no DB/socket, calls no model and performs no external action.
The provider checks exact actor/app/tenant/conversation/run on every call and honours AbortSignal.
It returns empty evidence for another legitimate run/scope; an unbranded scope is rejected.

To combine with [recall](scoped-recall.md), the host can return both evidence arrays from its
existing callback, after applying its normal ownership lookup. Reserve one of the ten evidence
messages for the plan, e.g. recall limit5 plus one plan message. Both sources share the existing
32KiB evidence cap and the actual input context budget; there is no separate unlimited channel.
Do not append these synthetic messages to conversation history.

## Contract and limits

- `ContextPlan` schemaVersion1: planId, positive revision, objective and1..8 ordered steps.
- A step contains id, goal, expected evidence and dependency IDs referencing distinct **earlier**
  steps. Duplicate IDs, self/cyclic/forward references and unsupported extra fields are rejected.
- Objective/goal/evidence each contain1..512 UTF8 bytes; IDs at most64 characters; complete
  serialized plan at most6144 bytes; final escaped evidence message at most8192 bytes. No silent
  truncation. Unicode scalar sequences are validated; NUL/unpaired surrogates are refused.
- No tool name/arguments schema, executable function, permission, approval or completion-state
  field. Checklist text may describe a desired action, but policy/approval alone admits a call.
- Plan source and binding are snapshotted immutably at factory construction. A canonical SHA256
  digest binds explicit identity fields, conversation/run, full plan and revision. It identifies
  content; it is not a signature, permission or execution idempotency key.

The wrapper is a **user-role advisory message**, placed through existing evidence preparation.
It stays outside system instructions, canonical messages, summary checkpoint, run events and
public API projection. It consumes the pinned context ceiling before model-start audit. If required
input does not fit, the run stops with the existing context budget failure; no planner gets extra
steps, model calls, output reserve or authority.

## Runtime and recovery

This is a checklist to consider, not an execution DAG. The engine does not execute step order,
mark progress, infer verified facts, skip input/approval, or treat planned work as completed.
The canonical history, persisted model/tool/approval ledger and budgets remain authoritative.
An unknown external effect cannot be retried or changed to success through checklist wording.

The host owns selection/version/storage and must reconstruct an intended provider after process
restart. Plan content is not pinned in the engine's durable checkpoint. Replacing a host provider
can change advisory evidence on a later model call; exact already-approved calls continue to use
their persisted arguments/digest, never newly described plan parameters. There is no promise of
resuming a persistent plan cursor. Omit the provider to return to baseline context behavior.

No automatic connection to learning proposals/user notes exists. Pending/rejected/stale memory
proposals must not be supplied as verified instructions or approval. Even accepted notes remain
user_asserted. Host-authored advisory text does not turn external data into system authority.

## Evaluation and deployment decision

`npm run planning:report` uses six fixed synthetic cases, three paired repeats, alternating
variant order. Every model decision is fixed independently of plan presence. Assertions check
same status/final content/tool arguments/call counts, plus explicit input/approval/unknown/error
handling. The report records internal request JSON bytes and approximate text tokens for **every**
model request. Repeated trials are not new independent tasks.

Output: artifacts/planning/p07-04.json and p07-04-trials.json. The manifest hashes actual source,
support fixtures, harness, reporter and package/lockfile; raw synthetic requests and order are
retained with a checksum. No `.env`, DB, credentials or live provider are read. Local loop timing
excludes fixture/provider construction and is not provider latency or a cold/warm benchmark.

Real-model semantic benefit, billed usage/cost, production latency and V4/Hermes superiority remain
NOT MEASURED. Automatic planning stays deferred; this opt-in port supports later controlled trials.
P08 regression/release work must preserve these exclusions and record provider/tool/config manifests.

No migration, dependency, HTTP endpoint/capability, skill registry, background planner, self-rewrite,
delegated agents or desktop component is introduced. Read [handoff](handoffs/P07-04.md) before edits.
