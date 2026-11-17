# QA reports

Report QA untuk di-review manusia. Setiap case berisi pertanyaan, kriteria otomatis, tool yang dipakai,
jawaban Viper, verdict, dan kotak centang reviewer. File di dalam folder run dibuat oleh generator; jangan
diedit manual. Analisis dan keputusan ditulis di halaman ini.

## Baseline aktif

**[Workin live, 17 November 2026](workin-live/2026-11-17-baseline/README.md)**: 40 case, Opus 5.5 effort medium,
prompt cache off vs on (5m). Run berikutnya dibandingkan dengan baseline ini.

| Run | Lulus | Effective input | Catatan |
| --- | ---: | ---: | --- |
| cache-off | 39/40 | 732 645 | WL-014 gagal karena grading, bukan jawaban (lihat temuan 2) |
| cache-on | 34/40 | 133 429 (**−82%**) | WL-035–040 gagal berturut-turut di akhir run: `model_failure` dari provider, 0 tool call |
| cache-on-ulang (6 case) | 6/6 | 21 423 | Enam case di atas diulang dengan cache on: semua lulus |

## Analisis baseline 17 November 2026

1. **Prompt cache tidak menurunkan kualitas.** Semua case lulus dengan cache on setelah gangguan provider
   diulang (34 + 6 = 40). Effective input turun 82%, karena prefix tools + system (6 926 token) dibaca dari cache
   di setiap call dan lintas run. Waktu per run naik (309 vs 256 detik), tetapi bagian kenaikan dari enam call
   yang gagal tidak dapat dipisahkan. Latency perlu diukur ulang.
2. **WL-014 adalah false negative grading.** Jawabannya "permintaannya Anda tolak saat konfirmasi" sudah benar,
   tetapi daftar kata kunci tidak memuat "tolak". Usulan: tambahkan "tolak" ke `answerAll` WL-014. Report lama
   bisa dinilai ulang dengan `REGRADE=1` di script compare.
3. **Kegagalan provider tidak di-retry.** `VIPER_MODEL_MAX_RETRIES` default 0, sehingga satu error sementara
   (rate limit/overload) langsung menggagalkan run (`model_failure`). Model smoke dan run ulang beberapa menit
   kemudian berhasil. Usulan: default retry > 0 untuk produksi. Ini keputusan engine/operasi (P08-03), bukan
   bagian X02.
4. **Identitas.** Engine src `d4eaebc5…` untuk dua run 40 case. Run ulang memakai `92c66130…`, karena GPT
   mengubah `bootstrap/worker/schema-guard.ts` di antaranya; jalur model, adapter, dan cache tidak berubah.
   Tanda "belum di-commit" pada service_attendance hanya berasal dari file log yang ikut ter-track git.

Rekomendasi X02: aktifkan `VIPER_MODEL_PROMPT_CACHE=5m` sebagai default, setelah reviewer menyetujui jawaban di
report ini. Keputusannya dicatat di [engine extensions plan](../engine-extensions-plan.md).

## Membuat QA run berikutnya

```text
# 1. reset data dummy (dari folder service_attendance), lihat docs/integration/workin-mcp-testing.md
# 2. jalankan eval live (satu atau beberapa varian)
WORKIN_TOKEN_FILE=<token> VIPER_MODEL_PROMPT_CACHE=5m node --env-file=.env --import tsx docs/integration/workin-live-eval.mts
# 3. buat report QA ke folder baru
node --import tsx docs/integration/workin-live-qa.mts --out docs/qa/workin-live/<tanggal>-<nama> \
  --title "<judul>" <label>=artifacts/evals/<run>/report.json [<label>=...]
# 4. bandingkan dengan baseline
node --import tsx docs/integration/workin-live-compare.mts \
  docs/qa/workin-live/2026-11-17-baseline/report-cache-on.json artifacts/evals/<run>/report.json
```

Salinan `report-*.json` di folder QA tidak berisi log event, tetapi tetap memuat jawaban dan manifest. Folder ini
yang menjadi baseline di git, karena `artifacts/` tidak di-commit. Data di dalamnya adalah data dev Workin (dummy
dan `db_employees` dev).
