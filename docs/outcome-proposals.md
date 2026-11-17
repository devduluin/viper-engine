# Outcome feedback and reviewed memory proposals

P07-03 extends [scoped recall](scoped-recall.md). `createEngineLearning(pool)` is an idle host-library
service; it does not call a model, modify prompts/source, schedule work or add HTTP routes.
Use the authenticated host's `TrustedScope`, not actor/app/tenant IDs supplied in request JSON.
Future transports can expose these versioned DTOs after implementing their own authenticated routes.

## Lifecycle

1. Run completes; the host presents its persisted result and execution evidence to the user.
2. User supplies feedback as a new text-only message in that conversation. The host calls
   `recordFeedback(scope, { runId, expectedRevision: 0, verdict: 'confirmed', source })`.
   Feedback itself can describe completed/partial/failed/cancelled runs; it cannot certify errors away.
3. Host proposes `{ runId, feedbackRevision, text }`. Candidate text is untrusted data, never an
   instruction/permission or active memory. Nothing automatically enters recall or model context.
4. User reviews the exact candidate. Reject with revision/digest; accept with revision/digest plus
   a selected post-run user statement containing **the exact candidate text**. An isolated “OK”
   cannot silently convert an assistant answer into a user statement.
5. Acceptance atomically creates an ordinary `user_asserted` note and records the proposal's
   accepted revision/audit. It does not prove the note is a verified world fact.

```ts
const learning = createEngineLearning(pool);
const feedback = await learning.recordFeedback(scope, {
  runId, expectedRevision: 0, verdict: 'confirmed', source: feedbackSource,
});
const proposal = await learning.propose(scope, {
  runId, feedbackRevision: feedback.revision, text: candidateText,
});
const accepted = await learning.review(scope, proposal.proposalId, {
  expectedRevision: proposal.revision, digest: proposal.digest,
  decision: 'accept', confirmation: exactUserStatementSource,
});
```

Sources use `{ conversationId, messageId }`; the host first appends an actual authenticated user
message through its conversation service. Learning neither invents a user identity/message nor
appends a synthetic confirmation. The executable demo deliberately uses **synthetic test users**.

## Evidence and review boundaries

- Proposal creation and acceptance require current `confirmed` feedback and a completed durable
  runtime checkpoint in final phase, no pending model call, and a final assistant message.
- Every persisted model call must have succeeded. Every tool call and every recorded dispatch
  attempt must have succeeded, with a complete dispatch audit matching the attempt counter.
  Failed, partial, cancelled, unknown, rejected, retry-wait and
  unfinished attempts are refused even if a later fluent response or user feedback claims success.
- “Clean” refers to engine-reported completion plus user attestation, not independent truth of every
  external system. Recovered-error trajectories are conservatively excluded in this first version.
- Evidence fingerprints bind explicit owner fields, run revision/event cursor, final message,
  model/tool/attempt ledger identities and statuses, tool argument digests and feedback snapshot.
  Acceptance recalculates this fingerprint. SHA256 is not a signature or authorization token.
- Proposal text/source/digests are immutable. All writes are scoped; source role/owner/conversation
  are also protected by foreign keys. Generated tool/assistant text is never a note source.
- Candidate text has an 8192 UTF8 byte cap. Lists use limits1..50; there are at most32 lifetime
  proposals and128 feedback revisions per run. Evidence is capped at1000 model calls,1000 tool
  calls and2000 dispatch attempts; oversized histories are refused rather than partially certified.
- Repeated identical proposal creation returns the existing item, including a terminal item;
  reviewed candidates cannot be revived by resubmission. Concurrent review has one CAS winner.

## Feedback correction and maintenance

Feedback revisions are append-only; write with the revision last read. Every replacement feedback,
including renewed confirmation, atomically stales older pending/accepted proposals. Accepted notes
are tombstoned only while still active at their original accepted revision and confirmation source.
If the user independently corrected/deleted that note, maintenance preserves that user decision.
Stale/rejected proposals cannot be accepted or revived. A new confirmed feedback revision can
produce a new proposal with a different digest, followed by a new explicit review.

This bounded maintenance runs inside the feedback transaction, with a database trigger and audit;
there is no background queue needing polling/recovery. No persistent maintenance job is needed
for this lifecycle. Lock order is run -> proposal -> note, compatible with recall's note-only edits.
Cancellation/timeout of a host request is not evidence that its transaction never committed.
After an uncertain response, read `feedback`/`getProposal`/`changes`; do not guess or blindly retry
with a new identity. Revision conflicts require refresh. Acceptance with a stale revision cannot
create another note.

## Persistence and privacy

Migration0012 adds `outcome_feedback`, `memory_proposals`, `memory_proposal_changes` to the new
engine schema. Apply it before using learning. Earlier migration checksums are unchanged.
Existing runtime/API/event/checkpoint formats are unchanged; there is no new HTTP capability flag.
Triggers guard pending creation, transitions, evidence, exact confirmation, source identity,
metadata audit and feedback invalidation. Application transactions add digest/CAS checks.

Feedback/audits retain source IDs and metadata, not copied message text or raw MCP outputs.
Candidate text is persisted once as a separate unverified proposal; it can contain private user
data. Note deletion/feedback revision does **not** erase proposal text, immutable source history
or audit. This is lifecycle retirement, not a global privacy-erasure API. Reads already underway
can see their earlier snapshot; subsequent recall loads omit retired notes.

Statement timeout is5s per SQL statement; the host still owns pool/network/transaction deadlines
and database privileges. This port must not be exposed as a model-callable memory-write tool with
an unauthenticated or model-generated scope/confirmation. No policy grant, executable playbook,
training, source self-rewrite, desktop or autonomous delegation is introduced.

## Validation

Run `npm run check`, `npm run api:export` and isolated PostgreSQL integration per P04-01.
`npm run example:learning` requires explicit loopback `VIPER_TEST_DB_*`; it never loads `.env`
or calls a live model. It creates/drops its own `viper_it_*` DB and demonstrates pending ->
accepted -> stale with note retirement. See [handoff](handoffs/P07-03.md) for actual evidence.
