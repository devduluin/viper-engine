# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 6/7

Kembali ke [ringkasan](README.md).

## WL-035 · tools · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Siapa saja yang belum check-in pada 17 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily
- Jawaban harus memuat: "Ghofur"
- Jawaban harus memuat: "Agung"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.798 in / 449 out · cache r0/w0 · 5.3 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada 17 November 2026 ada **2 karyawan yang belum check-in**. Keduanya sudah lewat batas toleransi terlambat:
> | Kode | Nama | Shift | Jam mulai | Batas toleransi |
> |---|---|---|---|---|
> | B-0348 | ACHMAD GHOFUR | Shift Pagi | 08:00 | 15 menit (08:15) |
> | B-0358 | AGUNG SETYO | Shift Pagi | 08:00 | 15 menit (08:15) |
> Dari 8 karyawan yang dijadwalkan hari ini, 6 sudah hadir (2 di antaranya terlambat). Tidak ada yang cuti, izin, atau tercatat tidak hadir.
> Hari ini masih berjalan, jadi status bisa berubah kalau mereka check-in nanti.

**cache-on**: ❌ FAIL · status `failed` · 2 model call · token 7.082 in / 111 out · cache r6.983/w95 · 31.7 dtk

- Tool dipanggil: hris_attendance_search_daily
- Alasan gagal: status failed not in completed
- Alasan gagal: answer lacks Ghofur
- Alasan gagal: answer lacks Agung

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 15.798 in / 399 out · cache r14.156/w1.636 · 6.2 dtk

- Tool dipanggil: hris_attendance_search_daily

> Ada **2 karyawan** yang belum check-in pada 17 November 2026. Keduanya terlambat karena sudah lewat batas toleransi:
> | Kode | Nama | Shift | Jam mulai | Toleransi |
> |---|---|---|---|---|
> | B-0348 | ACHMAD GHOFUR | Shift Pagi | 08:00 | 15 menit |
> | B-0358 | AGUNG SETYO | Shift Pagi | 08:00 | 15 menit |
> Dari 8 karyawan yang terjadwal hari ini, 6 sudah hadir (2 di antaranya terlambat) dan tidak ada yang cuti, izin, atau tercatat tidak hadir. Status ini bisa berubah karena hari masih berjalan.

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-036 · tools · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Pengajuan WFH siapa saja yang sudah disetujui pada bulan November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_search_requests
- Jawaban harus memuat: "adas" atau "silalahi"
- Jawaban tidak boleh memuat: "Agus Setiawan"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.075 in / 458 out · cache r0/w0 · 5.7 dtk

- Tool dipanggil: hris_attendance_search_requests

> Di bulan November 2026 hanya ada **1 pengajuan WFH yang sudah disetujui**:
> | Karyawan | Kode | Tanggal WFH | Alasan |
> |---|---|---|---|
> | adas silalahi | TESTING | 12 November 2026 | WFH karena renovasi rumah (dummy MCP) |
> Pengajuan ini baru dikirim tanggal 17 November 2026 pukul 16.34, jadi diajukan setelah tanggal WFH-nya lewat. Kode karyawan "TESTING" dan keterangan "dummy MCP" juga menunjukkan ini kemungkinan data uji coba, bukan pengajuan sungguhan.

**cache-on**: ❌ FAIL · status `failed` · 1 model call · token 0 in / 0 out · cache r0/w0 · 0.2 dtk

- Tool dipanggil: (tidak ada)
- Alasan gagal: status failed not in completed
- Alasan gagal: missing tool hris_attendance_search_requests
- Alasan gagal: answer lacks adas|silalahi

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 15.075 in / 491 out · cache r14.071/w998 · 7.0 dtk

- Tool dipanggil: hris_attendance_search_requests

> Pada November 2026 hanya ada **1 pengajuan WFH yang disetujui**:
> | Karyawan | Kode | Tanggal WFH | Alasan |
> |---|---|---|---|
> | adas silalahi | TESTING | 12 Nov 2026 | Renovasi rumah |
> Pengajuan ini kelihatannya data uji coba. Kode karyawannya "TESTING" dan keterangannya tertulis "(dummy MCP)". Pengajuannya juga baru masuk 17 Nov 2026 pukul 16.34, padahal WFH-nya tanggal 12 Nov. Kalau data uji coba tidak dihitung, berarti belum ada pengajuan WFH asli yang disetujui bulan ini.

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-037 · tools · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Apakah Agus Setiawan punya pengajuan lembur di bulan November 2026? Untuk tanggal berapa?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_search_requests
- Jawaban harus memuat: "18 November" atau "2026-11-18" atau "18 Nov"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.112 in / 306 out · cache r0/w0 · 4.1 dtk

- Tool dipanggil: hris_attendance_search_requests

> Ya, Agus Setiawan (D-0013) mengajukan 1 kali lembur di November 2026:
> - **Tanggal lembur:** Rabu, 18 November 2026 (besok)
> - **Alasan:** Lembur closing bulanan (dummy MCP)
> - **Status:** Masih menunggu persetujuan
> - **Diajukan:** 17 November 2026 pukul 16.34

**cache-on**: ❌ FAIL · status `failed` · 1 model call · token 0 in / 0 out · cache r0/w0 · 0.2 dtk

- Tool dipanggil: (tidak ada)
- Alasan gagal: status failed not in completed
- Alasan gagal: missing tool hris_attendance_search_requests
- Alasan gagal: answer lacks 18 November|2026-11-18|18 Nov

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 15.112 in / 325 out · cache r14.081/w1.025 · 4.3 dtk

- Tool dipanggil: hris_attendance_search_requests

> Ya, Agus Setiawan (D-0013) punya 1 pengajuan lembur di November 2026:
> - **Tanggal lembur:** Rabu, 18 November 2026 (besok)
> - **Alasan:** Lembur closing bulanan
> - **Status:** Menunggu persetujuan
> - **Diajukan:** 17 November 2026 pukul 16.34
> Selain itu, tidak ada pengajuan lembur lain di bulan ini.

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-038 · tools · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Rekap kehadiran Achmad Ghofur untuk periode 10 sampai 14 November 2026.

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_get_period_summary / hris_attendance_search_daily
- Jawaban harus memuat: "11 November" atau "2026-11-11" atau "11 Nov"
- Tidak boleh ada permintaan approval
- Catatan dataset: He was absent on 11 November and present the other days.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 16.044 in / 396 out · cache r0/w0 · 5.6 dtk

- Tool dipanggil: hris_attendance_get_period_summary

> Achmad Ghofur (B-0348) hadir 4 dari 5 hari terjadwal pada 10–14 November 2026. Ia tidak hadir 1 hari, yaitu Rabu, 11 November.
> | Tanggal | Status |
> |---|---|
> | Sel, 10 Nov | Hadir |
> | Rab, 11 Nov | **Tidak hadir** (alasan tidak dicatat) |
> | Kam, 12 Nov | Hadir |
> | Jum, 13 Nov | Hadir |
> | Sab, 14 Nov | Hadir |
> Tidak ada cuti atau izin yang disetujui pada periode ini.

**cache-on**: ❌ FAIL · status `failed` · 1 model call · token 0 in / 0 out · cache r0/w0 · 0.1 dtk

- Tool dipanggil: (tidak ada)
- Alasan gagal: status failed not in completed
- Alasan gagal: none of hris_attendance_get_period_summary|hris_attendance_search_daily
- Alasan gagal: answer lacks 11 November|2026-11-11|11 Nov

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 16.044 in / 467 out · cache r14.075/w1.963 · 5.7 dtk

- Tool dipanggil: hris_attendance_get_period_summary

> **Kehadiran Achmad Ghofur (B-0348), 10–14 November 2026**
> Achmad dijadwalkan kerja 5 hari. Dia hadir 4 hari dan tidak hadir 1 hari, yaitu Rabu, 11 November.
> | Tanggal | Status |
> |---|---|
> | Selasa, 10 Nov | Hadir |
> | Rabu, 11 Nov | **Tidak hadir** |
> | Kamis, 12 Nov | Hadir |
> | Jumat, 13 Nov | Hadir |
> | Sabtu, 14 Nov | Hadir |
> - Ketidakhadiran pada 11 November tidak punya alasan yang tercatat.
> - Tidak ada cuti atau izin yang disetujui.
> - Tidak ada hari kerja yang terlewat tanpa catatan kehadiran.

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-039 · robustness · cache-off ✅ · cache-on ❌ · cache-on-ulang ✅

**Pertanyaan:** Tampilkan daftar semua karyawan aktif yang berulang tahun di bulan Mei beserta tanggalnya.

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_list_birthdays
- Jawaban harus memuat: "20"
- Jawaban harus memuat: "Unang"
- Tidak boleh ada permintaan approval
- Catatan dataset: Long list (20 rows) with suspicious 2055 birth years in dev data.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 21.324 in / 1.167 out · cache r0/w0 · 11.4 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **20 karyawan aktif** yang berulang tahun di bulan Mei:
> | No | Tanggal | Nama | Kode |
> |---|---|---|---|
> | 1 | 1 Mei | Unang Sodikin | D-0012 |
> | 2 | 7 Mei | perski mak | ID-19239 |
> | 3 | 9 Mei | Muhammad Rafi Irfansyah | D-0040 |
> | 4 | 11 Mei | ACHMAD FATHONI | B-0360 |
> | 5 | 11 Mei | M HAIKAL FAKHREZI | B-0356 |
> | 6 | 16 Mei | SUWARDI SUWARDI | B-0371 |
> | 7 | 17 Mei | Fania Isfandiari Arifah | D-0016 |
> | 8 | 20 Mei | Irfan Choiruddin Anwar | D-0036 |
> | 9 | 21 Mei | AGUNG SETYO | B-0358 |
> … (baris berikutnya dipotong)

**cache-on**: ❌ FAIL · status `failed` · 1 model call · token 0 in / 0 out · cache r0/w0 · 0.1 dtk

- Tool dipanggil: (tidak ada)
- Alasan gagal: status failed not in completed
- Alasan gagal: missing tool hris_employees_list_birthdays
- Alasan gagal: answer lacks 20
- Alasan gagal: answer lacks Unang

> (tidak ada jawaban teks)

**cache-on-ulang**: ✅ PASS · status `completed` · 2 model call · token 21.324 in / 1.209 out · cache r14.081/w7.237 · 17.0 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **20 karyawan aktif** yang berulang tahun di bulan Mei:
> | No | Tanggal | Nama | Kode |
> |---|---|---|---|
> | 1 | 1 Mei | Unang Sodikin | D-0012 |
> | 2 | 7 Mei | perski mak | ID-19239 |
> | 3 | 9 Mei | Muhammad Rafi Irfansyah | D-0040 |
> | 4 | 11 Mei | ACHMAD FATHONI | B-0360 |
> | 5 | 11 Mei | M HAIKAL FAKHREZI | B-0356 |
> | 6 | 16 Mei | SUWARDI SUWARDI | B-0371 |
> | 7 | 17 Mei | Fania Isfandiari Arifah | D-0016 |
> | 8 | 20 Mei | Irfan Choiruddin Anwar | D-0036 |
> | 9 | 21 Mei | AGUNG SETYO | B-0358 |
> … (baris berikutnya dipotong)

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
