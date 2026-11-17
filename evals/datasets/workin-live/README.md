# workin-live dataset

Live model trials for Viper against the real MCP Workin stack (gateway_v3 → service_attendance +
service_employees). Unlike `evals/fixtures/scenarios` (scripted model responses, deterministic),
these cases send free-form questions to the configured model and grade what the engine actually
did: run status, MCP tools called, facts in the final answer, and approval behaviour.

- `cases.json`: 40 cases. Grading rules are in the file (`grading`).

  | Family | Cases | What it checks |
  | --- | --- | --- |
  | tools | 001, 003–011, 013, 015, 028–037 | right tool, right facts |
  | multi_step | 012, 016, 021–023 | combine several calls/days or both services |
  | multi_turn | 018–020 | clarification answered later, follow-up, user correction (`turns`) |
  | clarification / error | 002, 017 | ambiguous name, unknown employee (no invented data) |
  | approval | 014, 026, 027 | write needs approval; 026 is **accepted** (writes), 014/027 rejected |
  | out_of_scope | 024, 025 | no payroll/delete tool: decline, invent nothing |
  | robustness | 039, 040 | long list, valid empty result |

- Runner: `docs/integration/workin-live-eval.mts`.
  - `CASES=WL-001,WL-018` selects cases.
  - `TRIALS=3` repeats every case.
  - The report holds `byCase`: pass rate per case, and `allTrials` (pass^k).
  - `VARIANTS=baseline,checklist` runs every case with and without the generic P07-04 advisory
    checklist (`docs/integration/workin-live-plan.mts`, through `createPlanEvidence`), alternating
    order per trial. It writes `report-baseline.json` and `report-checklist.json`; compare them.
    First run: `docs/reports/P07-04-ablation.md` (live section).
  - Setup and services: `docs/integration/workin-mcp-testing.md`.
- Every report pins a `manifest` (`docs/integration/workin-live-manifest.mts`):
  - hashes of engine `src/`, dataset, runner and dummy seed;
  - Node/SDK versions;
  - model/effort;
  - host instruction;
  - the gateway's tool catalog (name, readOnly and hash of description/schema per tool);
  - commit and dirty files of gateway_v3, service_attendance and service_employees.

  The token and secrets are not written.
- Compare: `node --import tsx docs/integration/workin-live-compare.mts <base> <candidate>`.
  - It lists manifest differences (to check the comparison is fair), case regressions and
    improvements, and model calls, tokens and seconds per run.
  - `REGRADE=1` re-grades the observations in both reports with the current rules
    (`docs/integration/workin-live-grade.mts`).
  - `ALL=1` lists every case.
- Ground truth depends on the dev data described in `cases.json.environment` (dummy seed for
  10–21 November 2026 plus `db_employees` dev). Re-seeding with other data changes the answers.
- WL-026 writes one dummy-shift assignment (Agus Setiawan, 2026-11-25). Run
  `workin-dummy-seed.cjs --cleanup` and reseed for a clean state; without cleanup the case still
  passes if the service reports the schedule already exists.

Status: **reference evidence**, not a P08-01 baseline. Since 17 November 2026 reports pin a
manifest. The runner is still not part of `npm run check` or `eval:validate`, and P08-01 (which
depends on P07-04) decides whether and how this dataset enters the regression suite.

Results are stochastic. Compare only runs whose manifests match apart from the change you are
measuring, ideally with 3 trials per case. Reports from before 17 November 2026 have no manifest;
compare them with `REGRADE=1`. Re-grading confirms the history below: WL-014 0/1 → 1/1.

Reference results (claude-opus-5-5, effort medium, 17 November 2026):

| Run | Cases | Result | Report |
| --- | --- | --- | --- |
| pre-P07 engine, no host instruction | 001–017 | 16/17 (WL-014) | `artifacts/evals/workin-live-2026-11-17T08-47-38-671Z/report.json` |
| after P07-01 + user-rejection fix | 001–017 | 17/17 | `artifacts/evals/workin-live-2026-11-17T11-06-03-142Z/report.json` |
| same engine | 018–040 | 22/23 (WL-029) | `artifacts/evals/workin-live-2026-11-17T11-17-11-476Z/report.json` |
| after `list_shift_types` fix | 029 | 1/1 | `artifacts/evals/workin-live-2026-11-17T11-34-45-466Z/report.json` |

WL-029 failed because `list_shift_types` had no tolerance/check-in opening, so the model said the
data was unavailable. service_attendance now returns `toleranceMinutes` and `checkInOpensAt` there
(and the case accepts that tool). Dummy data was cleaned and reseeded after these runs.
Findings: `docs/handoffs/WORKIN-LIVE.md`.
