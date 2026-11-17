# Reuse source snapshot

Snapshot inspeksi pada 16 November 2026, Asia/Jakarta. Semua berstatus CANDIDATE; belum diadopsi.
SHA-256 dihitung atas bytes file working tree aktual, termasuk line endings. Bukan hash commit.
Jika source berubah, agen pelaksana merekam snapshot baru saat adopsi dan menjelaskan perbedaannya.

Source paths relatif ke src/utils proyek V4 dan bersifat catatan provenance saja.
Standalone CI tidak membutuhkan checkout proyek lama; tidak ada credential/env files.

| Source | Physical lines | SHA-256 |
| --- | ---: | --- |
| `async-helpers.util.ts` | 463 | `44310795f05543c37d0b359325d9ed6d63dcc5d7a42bdc36d875252a6d1d5b1c` |
| `mcp-execution-error.util.ts` | 248 | `342308893a71c53c5efb19f4c2d4d697d5c78d4c976ae6981fd7686c80e3fd76` |
| `resource-param-normalizer.util.ts` | 53 | `c9a53373c8de47dc1e79a5037b62024c04ea393bd306d7f252482d5189c408d2` |
| `result-emptiness.util.ts` | 27 | `2f5d750535565e5d35b71f28d2323a3d2d25ff68c1ac138ed9aa66aaf577597c` |
| `timezone.utils.ts` | 140 | `26ee246445e463f18b8a2134808d3295e6c93587640d256d6b52f28621cf3ce7` |
| `current-datetime.util.ts` | 30 | `17eb1ab4fdc499c12f791b2fe3db0fa557d0f0b1e5da329c81b4b014aea0208b` |
| `temporal/temporal-expression-parser.util.ts` | 562 | `c1481fd6dbf8aed0a1f8761abde06628833a065786d8cc22d362a2de3dabb8aa` |
| `temporal/temporal-locale-id.util.ts` | 32 | `bd22cc46e85a99ca8eb7c7dc9027295f7a7cdc409404c7b631c59b0541bf4843` |
| `temporal/temporal-locale-en.util.ts` | 17 | `86aa753f2158e7447f5539df78978b488ccdebd8d5629335d928da3ec14d84bb` |
| `token-estimator.utils.ts` | 150 | `b53697f6049c9cca5c53cdde379898cfeea6cabab98754dc045e90f870876f8c` |
| `hash.util.ts` | 228 | `76b960eb092feebbe9af35a5a466863a8f1456a2e950a708ad25c3e73a619541` |
| `circuit-breaker.util.ts` | 36 | `d5abe0e2c21c6956b1dc52e66369093cfaf56e40f4e31a51024e813d5ba99874` |
| `distributed-lock.util.ts` | 302 | `39fc92c9aac8b0da059b9c8ff15ca5a8e10feeab684a832f649341564a7e4cf5` |
| `public-response.util.ts` | 36 | `f66548dafabf033a94edcb360b3f3bcb6bbb0b6db781308c794363f0127b3460` |
| `response-contract.util.ts` | 86 | `289921a1922ebbdcecb9043c2dca13db31536420ee5d8ee22531a8804fdb1ed7` |
| `llm-prompt-trace.util.ts` | 26 | `cf059314d0196d78a7bbf8dbdd124a2f80781bde761caaba02aaf3989e1a2f8b` |
| `crypto.util.ts` | 50 | `2db2d7da7316f7a095a1cb2ce7225201587d80897f29cdcbfef70f748a128554` |

Behavior notes dan destinations: [reuse inventory](reuse-inventory.md).
Hash hanya membantu provenance; tidak menyatakan source tersebut aman atau cocok tanpa audit/tests.
