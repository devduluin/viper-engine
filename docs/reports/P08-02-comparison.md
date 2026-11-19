# P08-02: actual comparison state

Result: **INCONCLUSIVE**. Runner/report infrastructure validated; V4/Hermes execution is NOT_MEASURED.
Date:17 November2026, Asia/Jakarta. No engine superiority claim.

## Captures and actual commands

- Fresh P08-01 pipeline on the combined tree including Claude's cache support:
  artifacts/evals/regression-2026-11-17T16-19-05-209Z-6fa9c52d.
  Unit304 + contract157 =461 offline tests, PostgreSQL177/177, engine trials60/60 PASS;
  sourceDrift[] and cleanupErrors[]. Review cluster50568 stopped; viper_it_* DBs only.
- `node --import tsx examples/compare.ts <that capture directory>` produced
  artifacts/evals/comparison-2026-11-17T16-23-38-080Z-4ad9f3c3, status inconclusive, direct exit2.
  This expected nonzero code confirms that missing baselines are not silently called comparable.

The comparison consumed checksummed actual regression/TAP/trial evidence. It did not install,
execute or emulate V4/Hermes. Every task row and capability remains visible for all three engines.

| Coverage in this capture | Viper Engine | Viper V4 | Hermes |
| --- | --- | --- | --- |
| Development fixture cases | 10 measured/pass | NOT_MEASURED | NOT_MEASURED |
| Trials underlying case evidence | 60 | NOT_MEASURED | NOT_MEASURED |
| Deterministic critical groups | 6 measured/pass | NOT_MEASURED | NOT_MEASURED |
| Common paired tasks vs Viper | — | None available | None available |
| Comparative quality/latency/cost metrics | Not established | Not established | Not established |
| Superiority | NOT_ESTABLISHED | NOT_ESTABLISHED | NOT_ESTABLISHED |

All six cold/warm pair records have null metrics because both compatible captures are required.
This is absence of measurements, not zero task performance or unsupported engine features.
No confidence interval, billed saving or quality percentage is inferred from source inspection.

## Baseline references inspected

V4: local reference commit e98b60181f6069bfe72fdc070d31984b5238a8c6.32 loop modules plus package
and regression smoke hashed; aggregate699e1865eb518930f1a007fa36045fd320670c9479f683864b278a6c237aeb69.
The inspected smoke expects a running application server. Its source/task/provider configuration
is not an equivalent isolated harness and no application DB/environment was used. The partial
subtree/reference commit is not proof of whole-tree cleanliness or an executed baseline.

Hermes: official public HEAD reference27e389359263b7294e2788fee048953fc34b82d1, obtained via
git ls-remote; pinned pyproject SHA2566cb17aeeb63c8ecd78b748990598d05a8fe87e74f89fb2013a344d378a55bf1a.
[Official pinned source](https://github.com/NousResearch/hermes-agent/tree/27e389359263b7294e2788fee048953fc34b82d1).
No runtime/installer was executed. Local Python3.13.5 lacked installed openai/mcp packages;
this records setup availability, not Hermes capabilities or platform support.

## Interpretation and remaining work

Engineering acceptance here is a reproducible runner/report with honest unsupported/unmeasured
handling. Empirical cross-engine comparison remains incomplete. Obtain real isolated baseline
captures using the [shared protocol](../../evals/comparison/README.md), with frozen task/model/tool/
budget/state/control/timing semantics. If a baseline cannot align them, report incomparable.

Ten scripted development cases do not meet120 independent task/30 holdout live quality gates.
The runner retains manual review and superiority NOT_ESTABLISHED. P08-03/04 can advance engine
setup/release review while comparative claims remain prohibited without those measurements.

See [guide](../engine-comparison.md), [handoff](../handoffs/P08-02.md) and [review](../reviews/P08-02.md).
