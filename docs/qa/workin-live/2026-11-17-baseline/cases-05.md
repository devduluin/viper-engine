# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 5/7

Kembali ke [ringkasan](README.md).

## WL-028 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa saja yang dijadwalkan bekerja pada 20 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_schedule / hris_attendance_get_schedule
- Jawaban harus memuat: "Abraham"
- Jawaban harus memuat: "Ardi"
- Jawaban tidak boleh memuat: "belum check-in", "tidak hadir"
- Tidak boleh ada permintaan approval
- Catatan dataset: Future date: schedule, not attendance. The 8 dummy employees work Shift Pagi that day.

**cache-off**: ✅ PASS · status `completed` · 3 model call · token 29.186 in / 765 out · cache r0/w0 · 8.8 dtk

- Tool dipanggil: hris_attendance_search_schedule → hris_attendance_search_schedule

> Pada **20 November 2026**, ada **8 karyawan** yang dijadwalkan kerja dari total 280 karyawan aktif. Semuanya masuk **Shift Pagi**.
> | No | Kode | Nama |
> |---|---|---|
> | 1 | D-0013 | Agus Setiawan |
> | 2 | B-0358 | Agung Setyo |
> | 3 | B-0348 | Achmad Ghofur |
> | 4 | D-0006 | Abraham Gamaliel Figrana |
> | 5 | B-0360 | Achmad Fathoni |
> | 6 | D-0005 | Ardi Mahendra |
> | 7 | B-0432 | Ahmad Qayyim |
> | 8 | TESTING | adas silalahi |
> **Jam Shift Pagi:** 08.00–17.00. Check-in dibuka pukul 07.00, dan toleransi terlambat 15 menit.
> … (baris berikutnya dipotong)

**cache-on**: ✅ PASS · status `completed` · 3 model call · token 29.189 in / 740 out · cache r24.371/w4.810 · 8.6 dtk

- Tool dipanggil: hris_attendance_search_schedule → hris_attendance_search_schedule

> Ada **8 karyawan** yang dijadwalkan bekerja pada **Jumat, 20 November 2026**, dari total 280 karyawan aktif. Semuanya mendapat **Shift Pagi (dummy MCP)**:
> | No | Kode | Nama |
> |---|---|---|
> | 1 | D-0005 | Ardi Mahendra |
> | 2 | D-0006 | Abraham Gamaliel Figrana |
> | 3 | D-0013 | Agus Setiawan |
> | 4 | B-0348 | Achmad Ghofur |
> | 5 | B-0358 | Agung Setyo |
> | 6 | B-0360 | Achmad Fathoni |
> | 7 | B-0432 | Ahmad Qayyim |
> | 8 | TESTING | adas silalahi |
> **Detail shift:**
> … (baris berikutnya dipotong)

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-029 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa toleransi keterlambatan Shift Pagi (dummy MCP), dan jam berapa check-in sudah bisa dilakukan?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_list_shift_types / hris_attendance_get_schedule / hris_attendance_search_daily / hris_attendance_search_schedule
- Jawaban harus memuat: "15 menit"
- Jawaban harus memuat: "07:00" atau "07.00"
- Tidak boleh ada permintaan approval
- Catatan dataset: Shift rules (tolerance 15 min, check-in opens 07:00) are in list_shift_types since service_attendance adds toleranceMinutes/checkInOpensAt; schedule/daily results also carry them.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.793 in / 269 out · cache r0/w0 · 5.2 dtk

- Tool dipanggil: hris_attendance_list_shift_types

> Untuk **Shift Pagi (dummy MCP)** (kode DMCP, jam kerja 08:00–17:00):
> - **Toleransi keterlambatan:** 15 menit. Karyawan yang check-in setelah 08:15 dihitung terlambat.
> - **Check-in bisa dilakukan mulai:** pukul 07:00.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.793 in / 269 out · cache r14.089/w698 · 5.0 dtk

- Tool dipanggil: hris_attendance_list_shift_types

> Toleransi keterlambatan **Shift Pagi (dummy MCP)** adalah **15 menit**, dan check-in sudah bisa dilakukan mulai **pukul 07:00**.
> - **Jam shift:** 08:00–17:00 (kode DMCP)
> - **Batas toleransi:** karyawan yang check-in setelah **08:15** dihitung terlambat.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-030 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Ada berapa karyawan aktif yang bernama Agus?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_search
- Jawaban harus memuat: "3" atau "tiga"
- Jawaban tidak boleh memuat: "7 karyawan bernama Agus", "tujuh karyawan bernama Agus"
- Tidak boleh ada permintaan approval
- Catatan dataset: A name search for 'Agus' also matches 'Bagus'; only Agus Setiawan, AGUS RIFAI and Agus Ariyanto are named Agus.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 16.498 in / 346 out · cache r0/w0 · 5.0 dtk

- Tool dipanggil: hris_employees_search

> Ada **3 karyawan aktif yang bernama Agus**:
> 1. **Agus Ariyanto**, kode 2023010103151301
> 2. **AGUS RIFAI**, kode 202401020119130213
> 3. **Agus Setiawan**, kode D-0013
> Hasil pencarian sebenarnya ada 7. Tapi 4 di antaranya hanya muncul karena namanya mengandung "Bagus", jadi tidak saya hitung: Ardinas Bagus Prasetyo, Bagus Aditya Pratama, Bagus Fajar Syaifulloh, dan Perdana Bagus Kusuma.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 16.498 in / 378 out · cache r14.060/w2.432 · 5.2 dtk

- Tool dipanggil: hris_employees_search

> Ada **3 karyawan aktif** yang bernama Agus:
> 1. **Agus Ariyanto**, kode 2023010103151301
> 2. **AGUS RIFAI**, kode 202401020119130213
> 3. **Agus Setiawan**, kode D-0013
> Sistem sebenarnya menemukan 7 hasil. Namun, 4 di antaranya cocok hanya karena namanya mengandung "Bagus", jadi tidak dihitung: Ardinas Bagus Prasetyo, Bagus Aditya Pratama, Bagus Fajar Syaifulloh, dan Perdana Bagus Kusuma.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-031 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Kapan Agus Setiawan mulai bekerja?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_profile
- Jawaban harus memuat: "13 Mei 2024" atau "2024-05-13" atau "13-05-2024"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.910 in / 138 out · cache r0/w0 · 3.1 dtk

- Tool dipanggil: hris_employees_get_profile

> Agus Setiawan (D-0013) mulai bekerja pada **13 Mei 2024**. Masa kerjanya sekarang 2 tahun 6 bulan, dan statusnya masih aktif.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.910 in / 145 out · cache r14.058/w846 · 3.5 dtk

- Tool dipanggil: hris_employees_get_profile

> Agus Setiawan (D-0013) mulai bekerja pada **13 Mei 2024**. Sekarang dia sudah bekerja sekitar **2 tahun 6 bulan**, dan statusnya masih aktif.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-032 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa saja karyawan aktif yang berulang tahun tanggal 11 Mei?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_list_birthdays
- Jawaban harus memuat: "Fathoni"
- Jawaban harus memuat: "Haikal"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 21.302 in / 320 out · cache r0/w0 · 4.3 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **2 karyawan aktif** yang berulang tahun tanggal 11 Mei:
> 1. **ACHMAD FATHONI** (B-0360), lahir 11 Mei 1998, sekarang berusia 28 tahun
> 2. **M HAIKAL FAKHREZI** (B-0356), lahir 11 Mei 2004, sekarang berusia 22 tahun

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 21.302 in / 438 out · cache r14.070/w7.226 · 6.5 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **2 karyawan aktif** yang berulang tahun tanggal 11 Mei:
> | Nama | Kode | Tanggal lahir | Usia sekarang |
> |---|---|---|---|
> | ACHMAD FATHONI | B-0360 | 11 Mei 1998 | 28 tahun |
> | M HAIKAL FAKHREZI | B-0356 | 11 Mei 2004 | 22 tahun |
> Ulang tahun mereka tahun ini sudah lewat. Pada 11 Mei 2027, Achmad akan berusia 29 tahun dan Haikal 23 tahun.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-033 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa karyawan yang sudah keluar dari perusahaan?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_headcount
- Jawaban harus memuat: "2"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.596 in / 119 out · cache r0/w0 · 3.3 dtk

- Tool dipanggil: hris_employees_get_headcount

> Ada **2 karyawan** yang sudah keluar dari perusahaan.
> Total karyawan yang tercatat ada 292:
> - **Aktif:** 280
> - **Nonaktif:** 10
> - **Keluar:** 2

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.596 in / 122 out · cache r14.062/w528 · 3.2 dtk

- Tool dipanggil: hris_employees_get_headcount

> Ada **2 karyawan** yang sudah keluar dari perusahaan.
> Total karyawan yang tercatat ada 292 orang:
> - **Aktif:** 280
> - **Nonaktif:** 10
> - **Keluar:** 2

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-034 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Apakah Ahmad Qayyim sudah check-in pada 17 November 2026, dan jam berapa?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily
- Jawaban harus memuat: "08:16" atau "08.16"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 4 model call · token 35.774 in / 549 out · cache r0/w0 · 8.7 dtk

- Tool dipanggil: hris_attendance_search_daily → hris_employees_search → hris_attendance_search_schedule → hris_attendance_search_daily

> Ya, Ahmad Qayyim (B-0432) sudah check-in pada 17 November 2026 **pukul 08:16 WIB**.
> - **Shift:** Shift Pagi, 08:00–17:00, dengan toleransi terlambat 15 menit.
> - **Status:** Hadir, tetapi tercatat **terlambat 16 menit** karena check-in lewat dari batas toleransi (08:15).
> - **Check-out:** Belum ada.

**cache-on**: ✅ PASS · status `completed` · 4 model call · token 35.920 in / 765 out · cache r31.827/w4.083 · 52.6 dtk

- Tool dipanggil: hris_attendance_search_daily → hris_employees_search → hris_attendance_search_schedule → hris_attendance_search_daily

> Ya, **Ahmad Qayyim** (B-0432) sudah check-in hari ini, 17 November 2026, pada pukul **08:16 WIB**. Ia **terlambat 16 menit**.
> - **Shift:** Shift Pagi (dummy MCP), pukul 08:00–17:00. Batas toleransi terlambatnya 15 menit.
> - **Check-out:** belum ada.
> Catatan: pencarian pertama dengan nama "Ahmad Qayyim" tidak menemukan data. Penyebabnya, nama di sistem tertulis dengan dua spasi ("AHMAD  QAYYIM"). Kalau mencari karyawan ini lagi, pakai kode **B-0432** atau kata "Qayyim" saja.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
