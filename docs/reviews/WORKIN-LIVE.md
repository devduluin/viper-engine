# Workin live handoff triage

Status: source-reviewed/triaged; rejection fix offline-verified, 17 November 2026. Live rerun pending; not P08 completion.
[Claude handoff](../handoffs/WORKIN-LIVE.md) and its historical report remain the reference.
No live token, model, Workin service, seed or app database accessed during this P07-01 review.

| Finding | Assessment / follow-up |
| --- | --- |
| Rejected approval described as permission denial | Fixed in [user-rejection follow-up](../handoffs/WORKIN-REJECTION.md): exact server rejection becomes rejected_by_user/not_dispatched. Policy denial remains permission; later permissive policy cannot revive the rejected call. 408 offline / 148 PG cases pass; live wording not revalidated. |
| Recovered business error yields partial | Matches current conservative finalAnswerStop contract. A model's corrected answer does not erase an earlier failed effect. Any recovered-error semantics need explicit evidence/type and regression tests; do not silently mark success. |
| No host system instruction | Wiring gap in runner: ViperEngineOptions.instructions already accepts static or scoped async system messages; worker merges these with persistedRunInstructions. Supply trusted date/timezone/role there; prepareContext is not the only route. |
| MCP 404 session expiry and resource -32002 mapping | Fixed in [session follow-up](../handoffs/WORKIN-MCP-SESSION.md), three real protocol fixtures. Later acquire initializes afresh; failed call not replayed. Resource-only mapping keeps healthy sessions; live Workin not revalidated. |
| Setup failures invisible | Worker onEvent already reports safe failure codes and run_deliveries stores failure_code. Per-run correlation/final public diagnostics remain useful follow-ups; never expose raw SDK/SSO text. |
| WIP INTERNAL_ERROR / RECONNECT_LIMIT | ContextReport mistakenly used positive revision schemas for zero omission. Fixed in P07-01; no-compression, input/approval, terminal read/reconnect paths pass isolated full-stack regressions. Original live symptom not claimed revalidated. |

User-declined approval and session/resource fixes are complete. Host instruction wiring and
per-run setup diagnostics remain; then rerun WL-001/WL-014 before the full set.
Use actual model/config/source manifests, record new report and exclusions. Historical 16/17 after
rule tightening does not measure the current P07 source or superiority against Hermes/V4.

The live dataset/runner is separate from the frozen nine core scenario definitions. This review
does not fold it into eval:validate, run seed/cleanup, deploy staging code or certify its live grading.
