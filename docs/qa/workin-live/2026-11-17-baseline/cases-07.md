# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 7/7

Kembali ke [ringkasan](README.md).

## WL-040 · robustness · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Siapa yang tidak hadir pada 12 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily / hris_attendance_get_today_summary
- Jawaban harus memuat: "tidak ada" atau "0 karyawan" atau "nol" atau "semua karyawan hadir" atau "semua hadir"
- Jawaban tidak boleh memuat: "Ghofur"
- Tidak boleh ada permintaan approval
- Catatan dataset: Valid empty result: nobody was absent that day.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.936 in / 283 out · cache r0/w0 · 4.9 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada 12 November 2026, semua karyawan yang dijadwalkan masuk kerja. Tidak ada yang absen.
> - **Dijadwalkan:** 8 karyawan
> - **Hadir:** 8, termasuk 2 yang terlambat
> - **Tidak hadir:** 0
> - **Cuti atau izin:** 0
> Hari itu juga bukan hari libur. Ringkasan ini hanya menghitung karyawan yang punya jadwal shift pada tanggal tersebut.

**cache-on**: ❌ FAIL · status `failed` · 1 model call · token 0 in / 0 out · cache r0/w0 · 0.2 dtk

- Tool dipanggil: (tidak ada)
- Alasan gagal: status failed not in completed
- Alasan gagal: none of hris_attendance_search_daily|hris_attendance_get_today_summary
- Alasan gagal: answer lacks tidak ada|0 karyawan|nol|semua karyawan hadir|semua hadir

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 14.936 in / 266 out · cache r14.060/w870 · 14.3 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada 12 November 2026, semua karyawan yang dijadwalkan hadir. Tidak ada yang absen.
> - **Dijadwalkan kerja:** 8 karyawan
> - **Hadir:** 8 karyawan, 2 di antaranya terlambat
> - **Cuti/izin:** 0
> - **Tidak hadir:** 0
> Data ini hanya mencakup karyawan yang punya jadwal shift di tanggal tersebut.

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
