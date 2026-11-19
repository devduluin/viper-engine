# Package distribution and host environment

Engine is published as `@devduluin/viper-engine`; viper-host can keep the import alias
`viper-engine` using a local tarball dependency or exact npm alias. Source repos remain separate.
Engine development node_modules does not ship: the host image installs its own locked dependency
tree, including engine runtime dependencies. Nested npm dependencies can occur normally.

`files: ["dist"]` limits package payload. Standard npm metadata/README are also included. Clean
build removes stale dist, compiles and copies all migrations. `npm run package:check` requires
entries/declarations and exact source/output SQL hashes. `prepack` builds and verifies before
packing; do not distribute source-only checkout or omit SQL assets. No .env or key is packaged.

The tag-based publish workflow checks tag/version agreement, runs offline gates and publishes
the verified tgz to GitHub Packages. Registry visibility/access controls make the package private;
the npm `private:true` flag would block any publish, so it has been removed. No publish or tag was
performed during the packaging work. Release versions must not be overwritten.

Production uses viper-host's **process environment**. Host parses DB, provider, discovery and host
configuration and injects the engine options. Engine factories do not load process.env or .env
implicitly. This repo's .env remains for engine standalone/examples/evaluations only; viper-host
does not read it. Model/API/DB secrets belong in the host deployment environment, never frontend
build args, package metadata or registry credentials. Discovery env changes affect new runs;
existing runs retain their saved configuration. UI build values are separately owned by Next.

See sibling viper-host documentation: docs/ENVIRONMENT.md, docs/PACKAGING.md, docs/DEPLOYMENT.md
and docs/COMPOSE-SIMPLIFICATION.md. Its canonical Compose now builds the backend only, reads host
`.env`, runs migrations automatically and starts the host. UI owns its own Compose in its repo.
Host commits its selected engine artifact, so neither sibling source repo is needed for a server build.
No engine source checkout is required on a live server. Operator provisioning remains host-owned.

Packaging follow-up validates offline engine tests, host isolated provisioning and fresh production
installation/compiled runtime with real review PostgreSQL and fixture SSO. Startup now copies the
read-only listener options before calling Fastify, which mutates its input. A frozen-listener
compiled regression protects that boundary. Agent loop and database schema remain unchanged.
Claude's concurrent conversation-list API/client update is retained in the final package snapshot.
Actual Docker build and GitHub registry publish are not local evidence; Docker CI is provided as
a gate before image promotion. Local package smoke does not establish Linux/container correctness.
Final current-tree evidence:486 offline,185 PG,60 engine trials, host19 and clean runtime PASS;
actual Compose CLI5.8 merge/interpolation PASS, production audit0. See handoff for raw hashes/paths.
