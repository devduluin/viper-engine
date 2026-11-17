# Evaluation plan R2: engine quality

Status: target/metode, belum ada baseline/benchmark. Fokus engine MCP-first; desktop dan
migrasi/parity legacy tidak masuk release gate. Target melampaui V4/Hermes tetap harus dibuktikan.

## Apa yang diukur

Completion multi-step, pemilihan tool/args, penggunaan MCP resources/prompts yang tepat,
clarification, approval, recovery, context/recall, usage/latency, dan maintainability.
Tidak mengukur jumlah kategori registry, panjang reasoning atau jumlah folder sebagai kualitas.

Hermes menjadi acuan model/tool loop, history/context/provider boundaries. Dokumentasinya
bukan bukti score atau keterbatasan yang boleh diasumsikan.
[Hermes agent loop](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md)

## Comparison tracks

1. Common subset: tasks/model/tool fixtures dan budget setara pada engine yang dibandingkan.
2. Capability coverage: supported/unsupported/passed/failed/not measured pada suite engine penuh.

V4 schema dan kategorinya tidak dibutuhkan oleh dataset. Expose synthetic business actions lewat
fixture interfaces yang setara; perbedaan setup dijelaskan. Unsupported tasks tidak diam-diam
hilang dari coverage, tetapi tidak dicampur dengan quality pada common subset.

## Dataset target

Minimal 120 unique tasks untuk perbandingan matang; 30 holdout dibekukan sebelum tuning.
P00/P03 boleh mulai dari subset kecil deterministic untuk development, tanpa klaim benchmark win.

| Family | Count target | Contoh |
| --- | ---: | --- |
| Tool discovery dan schema | 20 | Namespace collisions, args validation, unavailable connection |
| Multi-step execution | 25 | Query -> detail -> transform -> result |
| Context/clarification | 15 | Missing IDs, ambiguity, corrections, topic switching |
| MCP resources/prompts | 15 | Read context, selected template, unsupported capability |
| Approval/access | 20 | Revise args, expiry, revoke, cross-user/app access |
| Persistence/recovery | 15 | Restart, duplicate requests, unknown write, event replay |
| Robustness/context budget | 10 | Loop, malformed output, large context, valid empty data |

Recall/notes/optional planning di P07 menambah targeted ablation fixtures bila diperlukan.
Tidak ada desktop/device/workspace/companion cases pada suite aktif R2.
Critical infrastructure cases deterministic dipisahkan dari stochastic model trials.

## Reproducibility manifest

Dataset/rubric/tool-fixture hashes dan split; engine commit/working-tree hashes; Hermes exact
version bila diukur; model/provider identifier/snapshot, settings/seed bila didukung; prompt,
MCP schemas/connection config dan initial conversation state; budgets/timeouts/concurrency;
OS/runtime/machine/network, cold/warm, timestamps; trial count dan raw outcomes/assertions.

Credentials/private payloads tidak disimpan sebagai fixtures. Reset isolated external state
antar trial. Simulated/isolated writes, bukan resource produksi. Semua helper/retry/model calls
ikut accounting; provider usage authoritative, token estimates diberi label approximate.

## Rubric and metrics

Completion hanya lulus jika final state/output/constraints benar dan required execution evidence
ada. Partial success dilaporkan terpisah. Klaim menulis/mengirim/menyimpan tanpa evidence membuat
case gagal. Deterministic assertions memeriksa fixture state, args, scope, event/ledger dan output.

Open-ended tasks dapat memakai blinded human/judge rubric dengan sample review dan disagreements.
Jangan mengandalkan self-judgment agent tanpa bukti. Ukur tool/parameter accuracy, extra calls,
unnecessary clarification, completion, critical failures, recovery, p50/p95 latency dan cost/success.

## Engineering release gates

- Semua critical deterministic invariants yang diuji lulus: ownership, approval binding,
  no completed-call replay, idempotency, cancellation, revision/lease correctness.
- Build/typecheck/lint/architecture/docs, relevant unit/contracts/integration/offline evaluations lulus.
- Fresh independent DB/setup dan API/events recovery terbukti; no legacy install prerequisite.
- File/function/complexity constraints dan dependency boundaries lulus.
- Material unsupported/unmeasured behaviors dilaporkan, bukan ditutupi sebagai passed.
- Tidak ada desktop, old-UI compatibility atau data-import gate.

Lulus suite tidak membuktikan bebas bug. Missing external benchmark access tidak menjadi
klaim kemenangan; engine release quality dan comparative superiority dilaporkan terpisah.

## Comparative targets

Target awal untuk klaim keunggulan, bukan hasil/jaminan:

- Common-suite completion >=90%.
- Positive paired quality difference dengan 95% confidence interval di atas nol.
- Target praktis +10 percentage points bila baseline <=90%; jika baseline >90%, >=20% relative
  failure reduction. Jika sample kurang, tambah independent tasks atau laporkan inconclusive.
- Pada workload/quality setara, target p95 <=1.10x dan cost/success <=1.15x baseline pembanding;
  tradeoff quality/latency/cost disajikan eksplisit.

Run minimal 3 trials per stochastic case dengan state reset; paired comparison pada tingkat task.
Repeat trials satu task bukan independent tasks baru. Report interval calculation method/seed;
control rate limits/tool latency, pisahkan cold/warm. Semua claims menyebut subset/config/date.
Jangan mengklaim unggul universal atau atas versi Hermes yang tidak diuji.

## Ablations

Simple loop vs optional planning; full catalog vs bounded discovery; full history vs compression;
recall/notes on/off jika diimplementasikan; deterministic verification/repair on/off.
Fitur yang tidak membantu tetap off/deferred. Tidak perlu mengimplementasikan skill/delegation
framework atau desktop untuk membuktikan loop engine yang lebih andal.

## Artifacts

Target paths: `evals/datasets/`, `evals/fixtures/`, `evals/manifests/`,
`artifacts/evals/<report-id>/`. Raw reports, metric calculations dan exclusions disimpan terpisah
runtime source. Artifact access/redaction/retention ditetapkan sebelum live measurements.
