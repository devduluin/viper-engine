# Cross-engine comparison evidence

P08-02 supplies a data-only comparison runner. It separates capability coverage from a fair common
task subset. It never starts V4/Hermes, loads their environment, or substitutes a fake implementation.
An absent baseline is NOT_MEASURED, not a failed task, zero score or unsupported engine capability.

## Run

```text
npm run eval:compare -- <full-regression-capture-directory> [external-capture-directory ...]
node --import tsx examples/compare.ts <capture-directory> [capture-directory ...]
```

Supply1..3 distinct engines: viper-engine, viper-v4, hermes. A P08-01 PostgreSQL report directory is
imported as Viper; an offline-only report is rejected. External directories use the version1
[capture protocol](../evals/comparison/README.md). Inputs are parsed JSON and files only; no commands,
dynamic code imports, provider calls or application database connections execute.

Direct Node exit codes:0 means all requested three-engine pairs/modes are comparable;2 means an
honest inconclusive/incomparable result with report written;1 means invalid/corrupt input. npm may
normalize nonzero exit codes, so inspect report.status. Exit0 is not a superiority or quality claim.
Duplicate engine captures are rejected; this is not a way to relabel one engine as another.

## Coverage and paired subset

The coverage matrix lists every task and capability present in supplied captures, against all three
engine IDs. Measured successes and failures stay visible. Unsupported requires an explicit adapter
declaration/reason; unmeasured/absent tasks cannot silently become unsupported or a zero score.
All exclusions from common pairs are retained with reasons.

Within each cold/warm pair:

- Dataset, rubric, tool contract, budget, model/settings, physical environment and timing definition
  must match. Digests are compared explicitly. Different engine code/runtime versions are expected
  variants and stay in provenance; their differences are not disguised as controlled inputs.
- Both participants must have measured the case, with matching family/split and exact repeat IDs.
  Unequal trial counts are excluded visibly; no cherry-picked intersection of repeats.
- Measured failures remain in the denominator. Scores are rubric outcomes, not merely completed
  conversation status. A properly refused write can pass a safety case without performing that write.
- Per-task mean outcome rates weight tasks equally; repeated trials do not become independent tasks.
  Counts/latencies/model/tool calls and exclusions remain available for audit.

## Statistics and claim gates

Scripted captures report deterministic rubric outcomes, never a semantic-quality confidence
interval. Live captures can compute a descriptive95% paired task percentile-bootstrap interval,
resampling task differences with replacement (seed17017,5000 resamples, recorded in manifest).
The method follows the paired/percentile definitions in [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html);
implementation is local TypeScript without SciPy or a statistical dependency. This method is not
BCa and does not guarantee coverage for a small/fixed/selected dataset.

Readiness records independent task count, holdout count, minimum3 trials per task, live generation
and candidate critical failures. The [evaluation targets](evaluation-plan.md) still require120
independent tasks,30 frozen holdouts, effect size/interval, quality and latency/cost checks plus
review. The runner deliberately emits superiority=NOT_ESTABLISHED even if numeric summaries look
favorable. It does not authenticate holdout chronology or substitute for independent review.

p50/p95 use the existing nearest-rank implementation with sample counts. Cost ratios require
explicit billed-cost evidence for every trial and a positive denominator; unknown or estimated
cost never becomes zero or a billed saving. Scripted SDK counters are not billing measurements.

## Input verification and output

P08-01 imports verify all declared checksums, manifest/report versions, complete suite names/raw
TAP counts, all cold/warm repeat identities, raw trial/summary binding, audit/count agreement,
grading check presence/consistency and within-run condition stability. Measured failures are kept.
Captured source hashes identify the executed code, not whatever source happens to exist now.
The reader validates retained grading evidence; it does not rerun an old source tree or a live model.

External captures require a pinned provenance/version, condition digests, explicit task statuses,
and checksummed raw artifacts. JSON fields are bounded/closed; negative/nonfinite metrics,
contradictory critical passes, missing trials, path traversal and symlinked/oversized evidence are
refused. Files are rehashed after analysis to detect input drift. A valid checksum establishes
integrity relative to the capture, not authorship or a signed runtime attestation.

Output under artifacts/evals/comparison-<UTC>-<suffix>/:

- inputs.json: normalized captures and original artifact paths/checksums.
- manifest.json: actual analyzer/source/reference hashes, statistics method/seed, Node and policies.
- report.json: task/capability matrices, pair conditions/exclusions/metrics, references and hashes of
  inputs/manifest. Inputs are preserved; no baseline artifact or historical result is overwritten.

## Actual baseline state

[Baseline references](../evals/comparison/baselines.json) pin local V4 reference commit/subtree bytes
and public Hermes source commit. They are source-inspection references, not execution manifests.
V4's inspected regression smoke expects a running application server; no equivalent isolated V4
capture exists here. Hermes is not installed/configured for the shared harness. Python package
inspection found no installed openai/mcp packages; this is a local setup observation, not a claim
that Hermes lacks MCP or cannot run on Windows.

The public Hermes commit and pyproject metadata were read from its
[official repository](https://github.com/NousResearch/hermes-agent/tree/27e389359263b7294e2788fee048953fc34b82d1).
No installer, app server, legacy database, provider key or live inference was invoked. Successful
comparison infrastructure is distinct from completed V4/Hermes measurements. See
[actual report](reports/P08-02-comparison.md) and [handoff](handoffs/P08-02.md).
