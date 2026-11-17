# WORKIN-LIVE: real MCP target and live evaluation for Viper

Status: SOURCE TRIAGED; rejection fix verified offline, live revalidation pending. Owner: Claude (worker), 17 November 2026. Not a checklist task; no
shared status/checklist edited. Integration owner decides whether/where to track it.

## What exists now

- Real MCP target outside this repo, all on `staging`:
  `gateway_v3` 8b5867b (standard MCP proxy: collect, validate SSO bearer, proxy),
  `service_attendance` fe5cd28 (9 tools), `service_employees` 2c6498a (4 tools). All 13 tools are
  in the `hris_company` account group, publish `meta.summary` + output field descriptions.
- Runbook: [workin-mcp-testing](../integration/workin-mcp-testing.md) (5 local processes, token,
  dummy data seed/cleanup, scenarios T1–T17).
- Live dataset: `evals/datasets/workin-live/cases.json` (17 cases) + README. Runner:
  `docs/integration/workin-live-eval.mts` (real engine via HTTP API/worker/engine like
  `examples/fixture-demo.ts`, configured model, isolated `viper_it_*` DB, approvals always rejected).
  Not part of `npm run check`/`eval:validate`; no shared eval schema/tooling changed.

## Pre-baseline reference (not P08-01)

`artifacts/evals/workin-live-2026-11-17T08-47-38-671Z/report.json`: anthropic claude-opus-5-5,
effort medium; 37 model calls, 284 403 input / 8 927 output tokens, 119 s for 17 cases.
Raw grading at run time 17/17; with the tightened WL-014 rule (added afterwards) **16/17**: WL-014
blamed missing permissions after the user rejected the approval (see finding 1).
Run against the engine source of that moment; P07-01 work started changing core files afterwards.

## Findings for the engine (no engine code was changed)

1. **User-rejected approval reaches the model as a policy denial.** On reject the call is planned
   as `{ code: 'permission', message: 'Tool call not permitted by policy' }`
   (`src/agent/execution/plan-call.ts:58`, decision from `application/durable/tool-commands.ts`).
   The model then tells the user to request access. Suggest a distinct code/message, e.g.
   `rejected_by_user` / "The user declined this action".
2. **Recovered business errors make the run `partial`.** `EMPLOYEE_AMBIGUOUS` → model retries with
   the right code → correct answer, but status `partial` (WL-002, WL-017). Consider whether a tool
   `isError` that the model recovered from should still downgrade the run.
3. **No host-level system instruction** (today's date, timezone, assistant role). Only
   `prepareContext` (resources/prompts) can add system messages, so questions had to state dates.
4. **MCP adapter** (P05 lane): reconnect when the gateway answers 404 (expired/unknown session);
   map `-32002` from `resources/read` to `not_found`.
5. **Setup failures are invisible to the host.** A run whose MCP setup kept failing ended
   `run.failed` after the duration limit with an empty payload and no model call; the cause
   (gateway 502 because the local SSO took 17 s) was found only by calling the pooled gateway
   directly. A failure code/reason in the event payload would help operators.
6. **Observed during P07-01 work in progress (unverified, likely WIP):** headless watch ended with
   `RECONNECT_LIMIT` although the run reached `run.completed`; `decideApproval` returned
   `INTERNAL_ERROR` right after `approval.required`. Please re-run the dataset after P07-01:
   `CASES=WL-001,WL-014` first.

## Re-running

```bash
cd D:/Development/App/viper-engine
VIPER_TEST_DB_HOST=127.0.0.1 WORKIN_TOKEN_FILE=<token file> node --env-file=.env --import tsx docs/integration/workin-live-eval.mts
```

Warm the local SSO first (`php artisan serve` can take 8–20 s on the first request after idle,
which the gateway reports as 502). Data/credentials stay outside this repo.

## Codex follow-up

Source findings triaged in [review](../reviews/WORKIN-LIVE.md). Item 1 corrected in the
[user-rejection handoff](WORKIN-REJECTION.md); 408 offline / 148 isolated PostgreSQL cases pass,
including exact denial after policy change and OS-kill recovery. Item 6's zero-counter schema bug
was corrected in P07-01. These checks do not constitute a new live Workin dataset run.
Item 4 is corrected in [MCP session/resource follow-up](WORKIN-MCP-SESSION.md), with three actual
SDK/HTTP protocol fixtures. P07-02 scoped recall/notes is also complete; live rerun remains pending.

## Live revalidation (Claude, 17 November 2026, after P07-01 and WORKIN-REJECTION)

- Runner now passes a trusted host instruction through the existing engine option `instructions`
  (role, today's date, Asia/Jakarta, Indonesian; no dataset answers). Finding 3 was a runner
  wiring gap, as the triage says, not an engine gap.
- WL-001 + WL-014 first, then the full set: **17/17** (`artifacts/evals/workin-live-2026-11-17T11-06-03-142Z/report.json`): 36 model calls,
  283 009 input / 6 900 output tokens, 95 s. WL-014 now answers that the user declined the action
  and nothing changed (no permission wording). No RECONNECT_LIMIT / INTERNAL_ERROR observed.
- WL-002 and WL-017 remain `partial` (recovered `EMPLOYEE_AMBIGUOUS` / not-found), as intended by
  the conservative final-answer contract; answers are correct.
- Not comparable as an improvement claim with the 16/17 reference: the host instruction and the
  engine source both changed between runs, and each set ran once (stochastic).

## Dataset extended to 40 cases (Claude, 17 November 2026)

- New WL-018–WL-040: multi-turn (clarification, follow-up, correction), multi-step across days and
  services, out-of-scope (payroll, delete), an **accepted** approval (WL-026 writes to the dev DB;
  seed `--cleanup` removes it), future schedule, valid empty result, long list.
- Runner supports `turns` (one conversation) and per-case `approvalDecision`.
- First run of the new cases: 22/23 (`artifacts/evals/workin-live-2026-11-17T11-17-11-476Z/report.json`),
  53 model calls, 439 586 / 11 771 tokens, 180 s. WL-029 fails: shift tolerance and check-in
  opening exist only in schedule/daily results, not in `list_shift_types`; the model looked only
  there and said the data is unavailable. Tool-design follow-up in service_attendance, not engine.
- WL-029 follow-up done in service_attendance (`list_shift_types` now returns `toleranceMinutes`
  and `checkInOpensAt`); rerun 1/1 (`artifacts/evals/workin-live-2026-11-17T11-34-45-466Z/report.json`).
  Dummy data cleaned (incl. the WL-026 write) and reseeded; employee list kept in
  `docs/integration/workin-dummy-employees.json`.


## P08-01 prep: pinned manifest, trials, compare (Claude, 17 November 2026)

Persiapan paralel saat GPT mengerjakan P07-03. P08-01 belum di-claim karena menurut DAG bergantung pada P07-04.
Hanya file milik lane ini yang diubah: `docs/integration/workin-live-*` dan `evals/datasets/workin-live/README.md`.
Tidak ada perubahan pada `src/`, progress, atau checklist.

- `workin-live-manifest.mts`: setiap report sekarang memuat `manifest`:
  - hash pohon `src/`, dataset, runner, dan dummy manifest;
  - versi Node, MCP SDK, dan Anthropic SDK;
  - model/effort dan host instruction;
  - katalog tool gateway (`tools/list`: nama, readOnly, dan hash description/schema);
  - commit dan file dirty dari gateway_v3, service_attendance, dan service_employees.

  Token dan secret tidak ditulis. Sudah diverifikasi dengan grep `Bearer`/`eyJ` pada report: 0.
- `TRIALS=n` (1–10). Report memuat `byCase` (passRate, `allTrials` = pass^k) dan `totals.casesAllTrials`.
- `workin-live-grade.mts`: aturan grading dipisah dari runner tanpa perubahan perilaku, supaya bisa dipakai ulang.
- `workin-live-compare.mts <base> <candidate>`:
  - menampilkan perbedaan manifest dan perubahan katalog tool;
  - menandai case yang regresi atau membaik;
  - menghitung model calls, token, dan detik per run;
  - `REGRADE=1` menilai ulang report lama dengan aturan saat ini.

  Diverifikasi: 08-47-38 vs 11-06-03 dengan `REGRADE=1` memberi WL-014 0/1 → 1/1 (94% → 100%), sesuai riwayat.
  Perubahan model atau schema tool yang disengaja ikut terdeteksi.
- Smoke live: WL-001 1/1 (`artifacts/evals/workin-live-2026-11-17T13-32-39-810Z/report.json`), 2 model call.
  Manifest mencatat service_attendance dirty: `list_shift_types` (WL-029 fix) belum di-commit.
- Untuk P08-01 nanti:
  - kandidat baseline: 40 case × 3 trial dengan manifest identik, setelah P07-04;
  - `VIPER_TEST_DB_*` di `.env` masih kosong, sehingga `test:integration` dan runner butuh env manual.
