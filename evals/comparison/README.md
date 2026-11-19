# Comparison capture protocol v1

The runner accepts verified P08-01 PostgreSQL regression directories directly. Other engines supply
`comparison-evidence.json` plus flat raw files. This is an evidence interchange format, not an agent
tool, runtime adapter stub, executable plugin or deployment workflow.

Envelope:

```json
{
  "schemaVersion": 1,
  "evidence": {
    "schemaVersion": 1,
    "engine": "hermes",
    "version": "exact executed version plus source/config identity",
    "datasetVersion": "the frozen shared dataset version",
    "conditions": {
      "dataset": "64-lowercase-hex SHA256",
      "rubric": "64-lowercase-hex SHA256",
      "tools": "64-lowercase-hex SHA256",
      "budget": "64-lowercase-hex SHA256",
      "model": "64-lowercase-hex SHA256",
      "environment": "64-lowercase-hex SHA256",
      "latency": "shared timing definition ID",
      "generation": "scripted"
    },
    "tasks": [],
    "capabilities": [],
    "provenance": "adapter/grader/raw capture source identity and limitations"
  },
  "artifacts": { "raw.json": "64-lowercase-hex SHA256 of actual bytes" }
}
```

This schematic intentionally has no runnable sample score/hash: at least one real task and valid
digests/files are required. Synthetic unit tests never become an actual Hermes/V4 benchmark report.

Task fields: id, family, split(development|evaluation|holdout), status(measured|unsupported|not_measured),
reason, trials. Measured requires1..100 unique repeat/mode trials; other statuses require none.
Each trial contains repeat(nonnegative integer), mode(cold|warm), passed(boolean), criticalFailure,
latencyMs, modelCalls, toolCalls, costUsd and costProvenance(unavailable|billed|estimate). Counts and
metrics are finite/nonnegative. Unavailable cost requires null; other cost sources require a number.
A critical failure cannot be marked passing. Capability fields are id/status/reason, with status
pass|fail|unsupported|not_measured. Duplicate IDs, unknown fields and malformed arrays are refused.

Only classify unsupported when the adapter/engine contract actually cannot expose the case, with
source/config evidence. Failed execution is a measured failure; an unavailable adapter/host/model
is not_measured. Never remove a failed case or rerun until a good result without retaining attempts.

For an external capture to be comparable to Viper:

1. Freeze the same tasks/rubric, tool schemas/results, initial state, model/settings/decisions,
   budgets, scope/approval controls and timing definitions before execution.
2. Pin the exact executed engine and adapter versions/source. Disable tools outside the declared
   fixture contract. Preserve argument/outcome semantics when translating wire protocols.
3. Reset fixture effects/state between trials. Record actual model/helper/tool attempts, unknown
   outcomes, grants and raw final state. Human/synthetic pause handling must use the same protocol.
4. Preserve raw observations and grader/source/config provenance. Never relabel regression data
   from one engine as another, or use prose/source inspection as proof that an engine executed.
5. Match condition digests with the documented normalization below, then import the capture.

Viper normalization uses createFingerprint(domain comparison.conditions,version1) over its captured
cases; rubric is the captured grade.ts SHA; tools are captured initial MCP catalog; budget includes
limits/context/maxModelCalls/maxOutputTokens/requestTimeoutMs. Scripted model digest covers fixed
cases/decisions. Environment covers platform/arch/release/CPU/engine-trial concurrency. Latency ID
is local-request-to-terminal-with-synthetic-control-v1. See regression-import.ts for exact fields.
If model/tool/settings/budget or timing cannot be aligned, retain the capture as incomparable rather
than assigning matching digests. Live data must use real shared model/snapshot/settings provenance;
it cannot borrow the fixed-script model digest.

Artifacts:1..4096 flat .json/.tap/.txt files, each <=16MiB, SHA256 matched; no paths, hidden files,
source symlinks, commands or dynamically loaded code. At most10000 tasks. Source hashes/receipts
are integrity evidence, not signatures. Keep private payloads/credentials out of raw captures.

[Usage/analysis](../../docs/engine-comparison.md). [Reference state](baselines.json).
