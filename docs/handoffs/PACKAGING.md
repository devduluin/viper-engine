# Packaging follow-up handoff

Deployment layout below is historical. Current host uses one `.env` and backend-only `compose.yaml`
with automatic migration; UI owns a separate Compose. Host commits its selected engine tarball.
Use `../viper-host/docs/DEPLOYMENT.md` and `../viper-host/docs/COMPOSE-SIMPLIFICATION.md` from the engine repo root.

Status: IMPLEMENTED / LOCAL VALIDATION PASS, GPT,18 November2026. User authorized engine/host packaging, explicit env
ownership and Docker readiness; no live publish/deployment or credentials migration.

Engine package is scoped @devduluin/viper-engine with dist allowlist, repository/registry metadata,
clean build, SQL/entry verification and prepack. Tag workflow runs gates then publishes the same
tgz artifact. npm private flag removed; GitHub controls private visibility. No dependency version,
schema or agent-loop change. Bootstrap now copies immutable caller listen options before Fastify
mutates them; compiled operations regression uses a frozen listener. Host keeps the viper-engine
alias with a locked checksummed tgz. Claude's conversation-list API/client changes were retained.

Host now parses its own supplied environment (DB/model/discovery) and no script falls back to
sibling engine .env. Separate local .env, container runtime env_file and Compose metadata are
documented. Provider secrets never enter package/image/UI. Existing secret files were not copied.

Host checks schema before provisioning and update queries fence app/tenant before modifying a
conflicting server. Regression verifies a rejected foreign app cannot change endpoint/revision.
Container installs once with npm ci, builds/prunes dev deps and copies the production tree.
Healthcheck is TCP only; authenticated readiness remains separate. Migration uses the host image.

Actual evidence is owned in viper-host/docs/PACKAGING-REVIEW.md and artifacts. Engine full check
325 unit+161 contract=486 PASS; full current-tree PG185/185 +60/60 engine trials PASS. Host real-PG
19/19 and clean prod compiled smoke PASS against the final combined tree. A learning fixture uses normal5s timeout for
semantic failures and1.5s for deliberate hanging calls; assertions/production limits unchanged.
Full Docker execution absent locally; official Compose-schema validation, actual Compose CLI
merge/interpolation checks on synthetic fixtures and actual Docker CI
provided. GitHub registry path prepared but no publication/install against a real private registry.
Final artifact SHA25655585f291f4b71ae8717f6ff24a32bf37cd2a6ffd6abe8bac9a3668a0a05c557;
engine raw capture artifacts/evals/regression-2026-11-18T14-36-34-641Z-f7a2f07f, no source drift,
raw hashes verified. Host packaging-verification.json verifies its source/manifest/dependency graph
matches clean runtime. Production audit0. Review50568 stopped, test DBs cleaned. Docker CI must
pass before release; no actual container/image build or package publication occurred locally.
