# engine-regression-v1

Ten synthetic development fixtures defined in tests/support/regression/cases.ts. Their fixed
decisions/expected outcomes and all source hashes are copied into each regression manifest.
There is no live tuning or independent holdout. The runner never asks a model to judge itself.

ER-001..010 cover final, dependent tools, valid empty, accepted/declined write, tool error, schema
refusal, unknown write, clarification and cancellation. Each trial checks authenticated scope,
idempotent start and no completed-effect replay. Broader OS-kill/lease/SSE/context/learning coverage
comes from the complete existing deterministic suites, with explicit file coverage and raw TAP.

The main data path uses real PostgreSQL/HTTP/MCP and model SDK with scripted fetch. Clarification
uses a provider-neutral scripted model port and unavailable usage. None measures real model quality.
Approval/refusal checks distinguish conversation completion from success of the requested write.

Three repeats x cold/warm produce60 trials. Each pair reuses one engine, resets business effects
and creates a fresh conversation/run; repeat pairs use a fresh isolated DB/server. Actual local
timings, usage provenance, catalog traffic and per-case results are retained in generated artifacts.

No change to foundation-v1 fixtures/schema/rubric or live Workin data. No 120-case comparison or
30-case holdout claim. [Runner and limitations](../../../docs/engine-regression.md).
