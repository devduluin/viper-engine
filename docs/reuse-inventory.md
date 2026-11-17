# Reuse inventory: utilitas Viper V4

Revision R2: candidates hasil inspeksi, **belum ada source yang disalin**.
Reuse bersifat selektif; compatibility/type mappers legacy tidak termasuk scope engine baru.
Detailed selection and adaptation requirements: [P02-01 manifest](reuse/P02-01.md).
Source root: `../../ai-intent-api-v2/src/` relatif terhadap dokumen ini.
Snapshot counts/hashes ada di [reuse source snapshot](reuse-source-snapshot.md).
Working tree lama memiliki perubahan lokal; hash file lebih tepat dari asumsi commit terakhir.

## Kebijakan adopsi

User mengizinkan copy/paste utilitas existing. Gunakan copy terkontrol atau adaptasi selektif,
bukan runtime import ke sibling repo. Setiap adopted symbol mencatat source hash aktual,
destination, semantic changes, dependency changes, license/ownership dan test results.

File >300 baris harus dipecah sebelum masuk source target. File kecil tetap diaudit karena
cache/user scope, retry, time, logging dan hashing dapat memiliki asumsi runtime lama.
Tidak perlu menyalin semua kandidat. Adopsi hanya yang dibutuhkan task engine saat ini;
defer/reject dicatat singkat dan bukan blocker untuk membangun loop MCP.

## Kandidat yang sudah diperiksa

| Source di `src/` lama | Lines | Rencana target | Keputusan dan syarat |
| --- | ---: | --- | --- |
| `utils/result-emptiness.util.ts` | 27 | `shared/results/emptiness.ts` | Copy/adapt; empty tidak otomatis failure |
| `utils/current-datetime.util.ts` | 30 | `shared/time/current-time.ts` | Copy/adapt dengan Clock dan timezone eksplisit |
| `utils/temporal/temporal-locale-id.util.ts` | 32 | `shared/time/locales/id.ts` | Reuse locale data/meridiem parser |
| `utils/temporal/temporal-locale-en.util.ts` | 17 | `shared/time/locales/en.ts` | Reuse locale data |
| `utils/token-estimator.utils.ts` | 150 | `shared/tokens/estimator.ts` | Reuse approximate counts; provider usage authoritative |
| `utils/mcp-execution-error.util.ts` | 248 | `adapters/mcp/errors/` | Copy/adapt; classifier bukan access authority |
| `utils/llm-prompt-trace.util.ts` | 26 | `adapters/observability/prompt-trace.ts` | Adapt Node AsyncLocalStorage dan redaction policy |
| `utils/resource-param-normalizer.util.ts` | 53 | Tidak diadopsi | Terikat legacy types/category model |
| `utils/public-response.util.ts` | 36 | Referensi konsep allowlist saja | Tidak mempertahankan legacy metadata contract |
| `utils/response-contract.util.ts` | 86 | Tidak diadopsi | Legacy UI footer/response compatibility di luar scope |
| `utils/async-helpers.util.ts` | 463 | `shared/async/{delay,deadline,retry,batch}.ts` | Extract/split, inject logger, cancellation-aware |
| `utils/temporal/temporal-expression-parser.util.ts` | 562 | Opsional `shared/time/parsers/` | Defer kecuali task nyata butuh; split sebelum adopsi |
| `utils/timezone.utils.ts` | 140 | Opsional `shared/time/timezone.ts` | Tidak membawa location/routing registry lama |
| `utils/hash.util.ts` | 228 | `shared/fingerprints/` | Extract cache-only functions; audit semantics separately |
| `utils/circuit-breaker.util.ts` | 36 | `adapters/resilience/circuit-breaker.ts` | Inspect implementation and concurrency behavior before adoption |
| `utils/distributed-lock.util.ts` | 302 | `adapters/coordination/` | Adapt only; Redis/cache/logger coupled and memory fallback |
| `utils/crypto.util.ts` | 50 | `adapters/credentials/` | Reuse concepts after audit, inject key-management port; no secret copy |

Line counts reflect inspected source on 16 November 2026. Hashes pin that snapshot; future
agents recompute when adopting. File counts do not waive function/complexity limits.

## Specific risks found from source

### Async helpers

`withTimeout` races a Promise and cleans its timer; this does not stop the underlying work.
The module also combines retry, batching, racing and circuit breaker logic and imports a
global logger. Extract separate components, propagate AbortSignal where supported, and let
policy decide whether repeating an operation is safe.

Test pending underlying work after timeout, success/error timer cleanup, retry exhaustion,
cancellation, invalid concurrency, and partial batch failures. Do not retry a side effect merely
because transport failure was classified transient.

### Hashing

`createHash` defaults to an 8-character MD5 fingerprint. `hashParams` sorts top-level keys but
uses nested JSON serialization and delimited strings; `paramsEqual` compares the short hashes.
It is not suitable as a security/integrity check for approval snapshots.

Preserve only explicitly non-security cache usage if suitable. New approval snapshots need
validated canonical values, recursive stable encoding, SHA-256 with a domain/version prefix,
and server-side trusted state. A digest is not a signature or independent authorization token.
Do not migrate hardcoded cities/date references from the same file into general agent routing.

### Temporal parsing

Parser uses locale helpers, default Asia/Jakarta, wall-clock Date transformations and debug
logging. Preserve useful ID/EN coverage but audit host-timezone interactions. Inject a Clock,
explicit timezone and locale; test UTC/Jakarta date boundaries, invalid dates/timezones,
leap dates, DST zones, and missing/ambiguous values. Remove console logging of user data.

### Distributed coordination

Current helper imports cache/logger and allows process-local fallback. Future durable
claims require database/lease correctness or an explicitly reviewed distributed algorithm.
Do not present a process-local lock as multi-instance protection. Test release ownership,
expiry, contention and stale lease holders; no fail-open fallback for correctness-critical work.

### Error and output helpers

MCP classifier is a useful portable normalization candidate. Preserve structured error codes
and `isError`; validate content blocks. Free-form messages cannot authorize a user or determine
which account is used. Keep operational retry hints separate from execution policy.

`isEmptyPrimitiveValue` is a value utility, not an execution verdict. A read that returns an
empty array can still succeed. Legacy public-response mapping tidak dipindahkan ke engine baru.

## Adoption record template

For each component append a record or create a short adjacent record under `docs/reuse/`:

```text
Component/task ID:
Source file + SHA-256 + selected exports:
Source license/ownership checked:
Destination file(s):
Copy / extraction / adaptation / rejected:
Dependencies removed or injected:
Behavior preserved:
Intentional behavior changes and why:
Characterization cases + command/results:
Source/function size and architecture checks:
Remaining gaps:
```

Licensing must reflect actual source/project ownership; do not invent an upstream license.
No raw credentials, environment values, logs with private payloads, or bundled dependency code
are part of utility reuse.

## Larger integrations

MCP client/sync/OAuth dan memory lama bukan pure utilities. Logic yang benar-benar dibutuhkan
boleh menjadi referensi P05/P07, tetapi registry/schema/singleton tidak dibawa ke engine baru.
Tidak ada kewajiban inventory atau migrasi semua fitur V4, scheduler/domain skills, atau UI.
