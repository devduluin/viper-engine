# Database design: schema baru untuk engine

Revision R2. Logical design P01-03/P04, implemented through migration 0010/P06-02.
Physical schema: 16 engine tables plus migration ledger; see [table details](schema/tables.md).
PostgreSQL menjadi default adapter awal. Schema/namespace default baru: `viper_engine`.
Nama database, credentials, dan provisioning ditentukan dari environment saat implementasi.
Tidak memakai tabel, foreign keys, migrations, atau IDs internal database Viper lama.

## Domain ownership

Conversation adalah percakapan; run adalah pekerjaan untuk satu tujuan; step adalah satu
iterasi keputusan. Model call dan tool call memiliki ID sendiri agar retries/usage/outcome
dapat diaudit. Satu run bisa melintasi beberapa turn ketika meminta input atau approval.

Trusted scope: actor subject dan app ID; tenant ID hanya jika deployment memiliki tenancy.
Adapter auth memetakan scope; request JSON tidak boleh mengganti principal. Relasi resource
menyimpan scope yang cukup untuk access checks dan composite constraints yang relevan.

## Logical tables pada fondasi persisten

| Entity/table | Tanggung jawab |
| --- | --- |
| `conversations` | Scope/owner, title, lifecycle, latest message reference |
| `messages` | Role/content blocks, conversation/run, provider/tool-call correlation |
| `runs` | Goal/status/revision/deadline/budget/checkpoint reference |
| `run_steps` | Iteration index, model decision, state transition, timing |
| `model_calls` | Attempt/provider/model/usage/outcome; sanitized metadata |
| `tool_calls` | MCP connection/server/tool identity, schema snapshot, validated args, outcome |
| `run_events` | Durable event envelope, per-run sequence, replay retention |
| `approvals` | Immutable proposal, exact scope/tool/version/params digest, lifecycle/expiry |
| `request_idempotency` | Scoped operation/key/payload fingerprint/resource reference/expiry |
| `mcp_servers` | Endpoint/transport/config reference, ownership, enabled state |
| `mcp_connections` | Actor/server binding, auth state, secret reference, granted capabilities |

Ini logical model, bukan kewajiban satu tabel per helper. P01-03 menetapkan columns,
constraints, indexes dan relationships dalam ADR/schema. P04 membangun schema baru beserta tests.
Jangan menambahkan generic resource taxonomy atau legacy compatibility columns.

## MCP catalog

Tools/resources/prompts didiscover dari MCP server, bukan dibuat manual sebagai tiga kategori
domain Viper. Catalog dapat dicache/versioned untuk efisiensi; MCP definition dan connection
availability menjadi sumber capability yang tersedia saat dispatch.

Tidak ada tabel custom `tools`, `knowledges`, `skills`, `intents`, intent examples/mappings,
atau mandatory embedding/vector collections dalam schema awal. Snapshot definition yang dipakai
saat tool execution disimpan pada `tool_calls` untuk audit, bukan sebagai registry legacy baru.

MCP tools adalah istilah protokol yang tetap dipakai dalam engine. Satu connection boleh
mengekspos tool IDs dengan namespace agar nama antar server tidak bertabrakan. Cache key
mencakup connection/access scope dan definition version; revoke/definition change invalidates cache.

## Persistence semantics

- `runs.revision` dipakai compare-and-set; transitions invalid/stale ditolak.
- `(run_id, sequence)` unique untuk durable events; state dan event disimpan atomik.
- Tool-call intent/claim disimpan sebelum external dispatch; outcome disimpan setelahnya.
- Lease/fencing ditinjau pada write checkpoint agar stale worker tidak mengambil alih progres.
- Unique constraints untuk request dedup scoped principal + operation + key.
- Approval binds exact run, connection/tool schema version dan final args; perubahan membuat
  proposal lama tidak berlaku. Acceptance/consumption dilakukan atomik.
- Ownership checks berlaku untuk run/message/events/approval/connection, termasuk resume.
- Unknown remote outcome tidak diubah menjadi failed/success tanpa evidence/reconciliation.
- Completion record tidak menghapus execution ledger yang dibutuhkan saat retry/restart.

Scope nilai nullable/tenant-independent harus ditangani eksplisit dalam unique constraints;
jangan mengandalkan perilaku NULL default untuk deduplikasi lintas deployment.

## Checkpoint dan content

Persist normalized provider-neutral messages dan tool-call/result pairing; provider-specific
opaque resume data boleh disimpan terpisah dengan version/expiry tanpa masuk core contracts.
Simpan decision/outcome/usage yang dibutuhkan, bukan raw hidden reasoning sebagai ketergantungan.
Payload besar memakai bounded references; bukan JSONB tanpa batas di setiap event/checkpoint.

Timestamps disimpan dalam UTC, sementara timezone pengguna eksplisit pada request context.
Validated JSONB dapat dipakai untuk content blocks/args/outcome/checkpoint yang versioned.
Columns yang diperlukan untuk ownership/state/idempotency tetap diberi constraints dan indexes.

## Ekstensi setelah fondasi

- P07-02 implements `memory_notes` and metadata-only `memory_note_changes` through migration0011;
  explicit user source FK, correction/deletion and [scoped recall](scoped-recall.md), not category DB.
- P07-03 adds migration0012 `outcome_feedback`, `memory_proposals`, `memory_proposal_changes`;
  [reviewed proposals](outcome-proposals.md), exact user confirmation and atomic feedback retirement.
- `jobs`/`outbox` bila dibutuhkan untuk durable worker/maintenance pada P06/P07.
- Artifact metadata/storage adapter bila use case nyata memerlukan file output.
- Procedural playbooks opsional; format/storage diputuskan saat ada evaluasi manfaatnya.

Tidak membuat tabel device/workspace pairing atau desktop-command ledger sekarang. Future
adapter dapat menambah schema sendiri melalui migrations baru tanpa mengubah core loop.

## Fresh install dan validasi

Migration runner hanya menyentuh database/schema baru yang dikonfigurasi. Dilarang menebak
connection string lama. Development DB harus isolated; destructive reset tidak mengenai legacy DB.
Integration tests memeriksa fresh install, constraints, concurrency, stale revisions, restart,
cross-scope access, event cursor consistency dan rollback/schema upgrade path yang dipilih.

Data import Viper lama, mapping IDs, compatibility UI, dan cutover bukan prerequisite release.
Jika diminta nanti, rancang import terpisah dan jangan menyalin pending approvals sebagai izin baru.
