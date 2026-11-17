# Durable/composition evidence archive

Moved intact from progress.md during P07-02. Current state is in [progress](progress.md).

## P04-02 / P05-01b / P05-03 review and P04-03 continuation

- User authorized review/fixes then continuation. Requested three handoffs approved; continued
  with Claude's newly handed P04-03 approval-policy review/fixes (dependency P04-02 now DONE).
- P04-02: no omitted-lease bypass after claim, proposal fencing, database-time expiry including
  renew/release, explicit owner/CAS wake, immutable idempotency claim generations and key locks,
  terminal execution admission and safe model audit fields. Six regression integration cases.
- Pre-release ports refined: release(at), complete/abandon(claimId), proposal lease and wake.
  Migration 0006 additive; applied earlier migration/checksum files were not rewritten by Codex.
- P05-01b: total stream/observer deadline + abort, completion/usage validation, safe errors,
  zero default SDK retry and endpoint hygiene. 12 OpenAI contract tests PASS.
- P05-03: scoped pool/open generations, total connect deadline, revoke/close races, held-session
  directory rechecks, post-advertisement admission, immutable prompt selection and later explicit
  refresh after HTTP 401. 30 MCP contract tests PASS; no failed tool automatically replayed.
- P04-03: deep snapshot arguments/schema before awaits, server enabled/private-owner checks,
  database-time proposal/accept/consume/revise expiry. Shared digest constant reused by session.
  Five new actual-store regressions; no HTTP or durable session driver claimed.
- Final `npm.cmd run check`: 188 unit + 132 contract = 320 PASS, zero failures/skips; all limits,
  docs/layer/cycle/type checks PASS. `npm.cmd run api:export`: build + OpenAPI artifact PASS.
- Independent `node scripts/run-tests.mjs integration`: 55/55 PASS using explicit isolated
  review settings (no .env/app/dev/V4 DB). Includes five P04-04 persistence cases; cluster stopped.
- User chose existing OpenAI key reuse; parsed configuration has no nonempty key/model. Initial
  raw presence check counted an empty quoted entry. No live call, key creation or secret edits.
- Reuse: P02 deadlines/fingerprints and contract parsers/constants directly; no legacy copies,
  new dependencies, root adapter exports, dataset changes or production migrations by reviewer.
- Notes: reviews/P04-02.md, P05-01b.md, P05-03.md and P04-03.md. Handoffs/checklist synchronized.
- Next at that checkpoint: complete P04-04 over Claude's persistence half, then P05-04 E2E.
  The later P04-04 completion record below supersedes that incomplete status.

## P04-04 completion

- User assigned Claude's persistence handoff and remaining durable driver to Codex. Prior
  P04-03/P05-01b/P05-03 review dispositions remain DONE; no new live provider work required.
- Persistence review: update run lock before conversation/event append, immutable message
  snapshots, runId required for assistant/tool messages, exact result origin and bounded,
  sequential snapshot reads. Findings recorded in reviews/P04-04.md.
- Added contracts/state/journal.ts, migration 0007/runtime_checkpoints, transaction-bound
  composition over reviewed stores and an atomic journal. Earlier migrations unchanged.
- Added application/durable/ and bootstrap/durable.ts: claim/load, validated versioned restore,
  same absolute deadline/ceilings/counters/fingerprints, heartbeat/cancel polling, approvals,
  amended inputs, terminal cleanup and conservative unknown recovery without tool replay.
- Core adds budget snapshot/restore, optional trusted resume state, decision/report metadata and
  correction boundary; SDK/database dependencies stay outside core. Public bootstrap export added.
- Four real fixture worker process kills verify recovery after effect, report, final message and
  model intent. Other cases cover cancellation/intent rollback, waiting cancellation, heartbeat,
  lost lease, amendment, retained duration/repetition/model ceiling and journal rollback.
- Final `npm.cmd run check`: 190 unit + 132 contract = 322 PASS; zero failures/skips; all limits,
  type/layer/cycle/docs checks PASS. `npm.cmd run api:export`: build + artifact PASS.
- Independent isolated PostgreSQL suite: 73/73 PASS, no warnings. Explicit review cluster and
  generated viper_it_* DBs only; cluster stopped, fixture child processes killed and awaited.
- No .env/app/dev/V4 DB, live model/MCP, dependency installs or dataset changes. Migration 0007
  delivered and tested on review databases; no application/dev migration applied by Codex.
- Reuse: existing P02 deadline/fingerprint helpers, P03 loop and reviewed P04 stores, through
  ports/composition; no duplicate legacy copies. Guide: durable-driver.md, handoff: handoffs/P04-04.md.
- P04 DONE (4/4), 23/36 tasks total. Next dependency-ready task: P05-04 real adapter E2E
  composition. API/action/event projection and daemon polling host remain P06; comparisons unmeasured.

## P05-04 completion

- User authorized continuation. Composed createViperEngine over reviewed P04 durable driver,
  actual model bindings, authorized pooled MCP discovery/aliases, production validator and
  mandatory host policy. Factory/config/type exports are bootstrap-only; no HTTP daemon added.
- Added small bootstrap engine components, pooled-gateway and schema adapter. Reuses P02
  deadlines/fingerprints, existing SDK/pool/aliases and atomic driver directly; no legacy copies.
- Fixed async-schema bypass/cache retention, OpenAI tool-image projection, unsupported audio
  terminal handling and cold-connect/request allowance. Full detail: reviews/P05-04.md.
- Thirteen new DB E2E cases cover actual SDK scripted fetch, real local MCP HTTP/stdio,
  read chain, approved write/new engine, validation, isError, auth/revoke, content, unknown,
  shutdown recovery and same-name multi-connection routing. No tool retry after unknown.
- Production deps Ajv 8.17.1 and ajv-formats 3.0.1 pinned; already installed, lock updated
  offline. Schema compiler is synchronous/no remote loading/no argument mutation. No migrations.
- Final check: 194 unit + 134 contract = 328 PASS, zero failures/skips; all type/lint/architecture/
  docs gates and fixture validation PASS. API export/build and compiled public composition smoke PASS.
- Isolated PostgreSQL: 86/86 PASS after the cold-stdio timeout fix; cluster stopped. Explicit
  review settings/viper_it_* DBs only; no .env, app/dev/V4 DB, live provider or secret changes.
- Guide engine-composition.md and handoff handoffs/P05-04.md describe host integration, defaults,
  error boundaries and actual limitations. Live model compatibility and Hermes/V4 win unmeasured.
- P05 DONE (4/4), 24/36 total. P06-01 HTTP next; P06-02 SSE and P06-03 daemon can split lanes
  after P06-01 DONE. Desktop/delegation remain deferred; no P06 work automatically started.
