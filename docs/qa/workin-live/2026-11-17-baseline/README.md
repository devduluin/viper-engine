# QA Workin live: baseline 17 November 2026 (prompt cache off vs on)

Dibuat 2026-11-17 oleh `docs/integration/workin-live-qa.mts` dari report live Viper
(model sungguhan → gateway MCP Workin → attendance + employees, data dev dummy). Jangan edit manual; buat ulang dari report.

## Ringkasan

| Run | Model / effort / cache | Lulus | Model call | Token input | Cache read / write | Effective input | Token output | Detik |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cache-off | claude-opus-5-5 / medium / cache off | 39/40 | 89 | 732.645 | 0 / 0 | 732.645 | 18.168 | 256 |
| cache-on | claude-opus-5-5 / medium / cache 5m | 34/40 | 83 | 632.972 | 548.107 / 84.635 | 133.429 | 15.722 | 309 |
| cache-on-ulang | claude-opus-5-5 / medium / cache 5m | 6/6 | 12 | 98.289 | 84.524 / 13.729 | 21.423 | 3.157 | 55 |

Effective input = input tanpa cache + 1,25 × cache write + 0,05 × cache read (harga relatif Opus 5.5, TTL 5 menit).

## Perbedaan hasil antar run

- WL-014 (approval): cache-off gagal, cache-on lulus
- WL-035 (tools): cache-off lulus, cache-on gagal, cache-on-ulang lulus
- WL-036 (tools): cache-off lulus, cache-on gagal, cache-on-ulang lulus
- WL-037 (tools): cache-off lulus, cache-on gagal, cache-on-ulang lulus
- WL-038 (tools): cache-off lulus, cache-on gagal, cache-on-ulang lulus
- WL-039 (robustness): cache-off lulus, cache-on gagal, cache-on-ulang lulus
- WL-040 (robustness): cache-off lulus, cache-on gagal, cache-on-ulang lulus

## Case yang gagal

- cache-off · WL-014: answer lacks ditolak|tidak disetujui|menolak|tidak menyetujui|dibatalkan
- cache-on · WL-035: status failed not in completed; answer lacks Ghofur; answer lacks Agung
- cache-on · WL-036: status failed not in completed; missing tool hris_attendance_search_requests; answer lacks adas|silalahi
- cache-on · WL-037: status failed not in completed; missing tool hris_attendance_search_requests; answer lacks 18 November|2026-11-18|18 Nov
- cache-on · WL-038: status failed not in completed; none of hris_attendance_get_period_summary|hris_attendance_search_daily; answer lacks 11 November|2026-11-11|11 Nov
- cache-on · WL-039: status failed not in completed; missing tool hris_employees_list_birthdays; answer lacks 20; answer lacks Unang
- cache-on · WL-040: status failed not in completed; none of hris_attendance_search_daily|hris_attendance_get_today_summary; answer lacks tidak ada|0 karyawan|nol|semua karyawan hadir|semua hadir

## Identitas run

- **cache-off**: [report-cache-off.json](report-cache-off.json), engine src `d4eaebc56cb9`, dataset `de18118e9676`, katalog 13 tool / 6.926 token, service: gateway_v3 8b5867b, service_attendance 1c6b22e (belum di-commit: logs/activity/activity.log, logs/error/error.log), service_employees 7ba8d24
- **cache-on**: [report-cache-on.json](report-cache-on.json), engine src `d4eaebc56cb9`, dataset `de18118e9676`, katalog 13 tool / 6.926 token, service: gateway_v3 8b5867b, service_attendance 1c6b22e (belum di-commit: logs/activity/activity.log, logs/error/error.log), service_employees 7ba8d24
- **cache-on-ulang**: [report-cache-on-ulang.json](report-cache-on-ulang.json), engine src `92c661308e33`, dataset `de18118e9676`, katalog 13 tool / 6.926 token, service: gateway_v3 8b5867b, service_attendance 1c6b22e (belum di-commit: logs/activity/activity.log, logs/error/error.log), service_employees 7ba8d24

## Detail per case

- [cases-01.md](cases-01.md): WL-001 – WL-008
- [cases-02.md](cases-02.md): WL-009 – WL-014
- [cases-03.md](cases-03.md): WL-015 – WL-020
- [cases-04.md](cases-04.md): WL-021 – WL-027
- [cases-05.md](cases-05.md): WL-028 – WL-034
- [cases-06.md](cases-06.md): WL-035 – WL-039
- [cases-07.md](cases-07.md): WL-040 – WL-040

## Cara review

1. Buka file detail; tiap case berisi pertanyaan, kriteria otomatis, tool yang dipakai, dan jawaban Viper.
2. Verdict ✅/❌ berasal dari aturan otomatis di `evals/datasets/workin-live/cases.json` (cek kata kunci, tool, status, approval).
   Itu belum tentu sama dengan penilaian manusia: beri centang pada "Reviewer" dan tulis catatan bila jawaban salah, kurang, atau tidak pantas.
3. Bandingkan dengan run lain memakai `docs/integration/workin-live-compare.mts <base.json> <candidate.json>`.
