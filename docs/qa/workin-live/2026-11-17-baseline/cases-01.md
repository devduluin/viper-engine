# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 1/7

Kembali ke [ringkasan](README.md).

## WL-001 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Ardi Mahendra lahir tanggal berapa?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_profile
- Jawaban harus memuat: "25 Januari 1991" atau "25-01-1991" atau "1991-01-25"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.937 in / 123 out · cache r0/w0 · 3.8 dtk

- Tool dipanggil: hris_employees_get_profile

> Ardi Mahendra (D-0005) lahir pada **25 Januari 1991** di Sinar Seputih. Usianya sekarang 35 tahun.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.937 in / 123 out · cache r7.075/w7.856 · 3.1 dtk

- Tool dipanggil: hris_employees_get_profile

> Ardi Mahendra (D-0005) lahir di Sinar Seputih pada **25 Januari 1991**. Sekarang usianya 35 tahun.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-002 · clarification · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Kapan ulang tahun Ardi?

**Yang diharapkan**

- Status yang diterima: completed / partial / waiting_for_input
- Tool wajib dipanggil: hris_employees_get_profile
- Jawaban harus memuat: "Ardinas" atau "Ardik" atau "lebih dari satu" atau "beberapa karyawan" atau "yang mana" atau "maksud"
- Tidak boleh ada permintaan approval
- Catatan dataset: Several employees match 'Ardi'. Pass if the answer surfaces the ambiguity (asks or names alternatives).

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.997 in / 398 out · cache r0/w0 · 5.7 dtk

- Tool dipanggil: hris_employees_get_profile

> Ada lebih dari 10 karyawan yang namanya mengandung "Ardi", jadi saya perlu tahu yang mana. Yang namanya persis "Ardi" hanya ini:
> - **Ardi Mahendra (D-0005)**
> Pilihan lain yang namanya mirip:
> - Ardik Susilo (2024010201191302102)
> - Ardinas Bagus Prasetyo (20240103119130107)
> - Dicky Ardianto Pratama (20250303010215207)
> - Fandi Ardiansyah (20250303010215224)
> - …dan beberapa lainnya
> Apakah yang Anda maksud Ardi Mahendra? Jika bukan, sebutkan nama lengkap atau kodenya.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.997 in / 507 out · cache r14.053/w1.938 · 6.1 dtk

- Tool dipanggil: hris_employees_get_profile

> Ada lebih dari 10 karyawan yang namanya cocok dengan "Ardi", jadi saya perlu tahu yang mana. Ini 10 yang pertama:
> 1. **Ardi Mahendra** (D-0005)
> 2. Ardik Susilo (2024010201191302102)
> 3. Ardinas Bagus Prasetyo (20240103119130107)
> 4. Dia Fitri Ardiana (20250303010215203)
> 5. Dicky Ardianto Pratama (20250303010215207)
> 6. Fandi Ardiansyah (20250303010215224)
> 7. Fardiansyah Aris Afifudin (B-0353)
> 8. Fiqih Hardiansyah (B-0347)
> 9. Muhammad Ferry Ardiansya (2025010102021332)
> 10. Muhammad Teguh Ardiansah (2025010102021307)
> Di daftar ini, yang bernama persis "Ardi" hanya **Ardi Mahendra (D-0005)**. Apakah dia yang Anda maksud? Kalau bukan, sebutkan nama lengkap atau kodenya.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-003 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa jumlah karyawan aktif di perusahaan kita?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_headcount
- Jawaban harus memuat: "280"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.596 in / 145 out · cache r0/w0 · 3.4 dtk

- Tool dipanggil: hris_employees_get_headcount

> Saat ini perusahaan punya **280 karyawan aktif**, terdiri dari 263 laki-laki dan 17 perempuan.
> Total karyawan yang tercatat ada 292 orang. Selain yang aktif, 10 orang berstatus nonaktif dan 2 orang sudah keluar.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.596 in / 136 out · cache r14.062/w528 · 4.0 dtk

- Tool dipanggil: hris_employees_get_headcount

> Saat ini ada **280 karyawan aktif**, terdiri dari 263 laki-laki dan 17 perempuan.
> Total karyawan yang tercatat ada 292 orang. Selain yang aktif, 10 orang nonaktif dan 2 orang sudah keluar.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-004 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa karyawan perempuan yang masih aktif?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_headcount
- Jawaban harus memuat: "17"
- Jawaban tidak boleh memuat: "280 perempuan"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.588 in / 101 out · cache r0/w0 · 2.7 dtk

- Tool dipanggil: hris_employees_get_headcount

> Ada **17 karyawan perempuan** yang masih aktif, dari total 280 karyawan aktif. Sisanya, 263 orang, adalah karyawan laki-laki.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.588 in / 112 out · cache r14.058/w524 · 3.5 dtk

- Tool dipanggil: hris_employees_get_headcount

> Saat ini ada **17 karyawan perempuan yang masih aktif**, dari total 280 karyawan aktif. Karyawan aktif lainnya, yaitu 263 orang, adalah laki-laki.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-005 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa saja yang terlambat masuk kerja pada 12 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_search_daily
- Jawaban harus memuat: "Abraham"
- Jawaban harus memuat: "Ardi"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.618 in / 368 out · cache r0/w0 · 5.5 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada **12 November 2026**, ada **2 karyawan yang terlambat**. Keduanya masuk Shift Pagi (mulai 08.00, batas toleransi 15 menit):
> | Nama | Kode | Check-in | Terlambat | Check-out |
> |---|---|---|---|---|
> | Abraham Gamaliel Figrana | D-0006 | 08.36 | 36 menit | 17.05 |
> | Ardi Mahendra | D-0005 | 08.25 | 25 menit | 17.05 |
> Dari 8 karyawan yang dijadwalkan masuk, semuanya hadir. Tidak ada yang cuti/izin atau tidak masuk.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.618 in / 429 out · cache r14.066/w1.546 · 5.7 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada **12 November 2026** ada **2 karyawan yang terlambat**. Keduanya masuk Shift Pagi yang mulai pukul 08.00 dengan toleransi 15 menit.
> | Karyawan | Kode | Jam masuk | Terlambat | Jam pulang |
> |---|---|---|---|---|
> | Abraham Gamaliel Figrana | D-0006 | 08.36 | 36 menit | 17.05 |
> | Ardi Mahendra | D-0005 | 08.25 | 25 menit | 17.05 |
> Jumlah menit terlambat dihitung dari pukul 08.00, bukan dari batas toleransi 08.15.
> Hari itu 8 karyawan dijadwalkan kerja dan semuanya hadir. Tidak ada yang cuti, izin, atau tidak masuk.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-006 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa karyawan yang hadir pada 17 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_get_today_summary / hris_attendance_search_daily
- Jawaban harus memuat: "6"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 14.802 in / 284 out · cache r0/w0 · 4.7 dtk

- Tool dipanggil: hris_attendance_get_today_summary

> Pada **17 November 2026**, ada **6 karyawan yang hadir** dari total 8 karyawan yang terjadwal.
> - **Hadir:** 6 orang, termasuk 2 yang datang terlambat
> - **Belum check-in:** 2 orang, dan keduanya sudah lewat batas toleransi keterlambatan
> - **Cuti/izin:** 0
> - **Tidak hadir:** 0
> Data ini bisa berubah karena hari ini masih berjalan.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.802 in / 297 out · cache r14.061/w735 · 4.6 dtk

- Tool dipanggil: hris_attendance_get_today_summary

> Pada **17 November 2026**, ada **6 karyawan yang hadir** dari 8 karyawan yang dijadwalkan masuk.
> - **Hadir:** 6 karyawan, 2 di antaranya terlambat
> - **Belum check-in:** 2 karyawan dan sudah lewat batas toleransi
> - **Cuti/izin:** 0
> - **Tidak hadir:** 0
> Mau saya tampilkan nama karyawan yang terlambat atau yang belum check-in?

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-007 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa yang cuti pada 13 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily / hris_attendance_get_period_summary
- Jawaban harus memuat: "Fathoni"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.234 in / 275 out · cache r0/w0 · 5.1 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada **13 November 2026** hanya **1 karyawan** yang tercatat cuti/izin:
> - **ACHMAD FATHONI** (B-0360), dijadwalkan Shift Pagi pukul 08.00
> Data hari itu tidak membedakan cuti dan izin. Dari 8 karyawan yang dijadwalkan, 7 hadir (1 terlambat) dan tidak ada yang absen.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.256 in / 252 out · cache r14.057/w1.193 · 4.2 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada 13 November 2026, hanya **1 karyawan** yang tercatat cuti/izin:
> - **ACHMAD FATHONI** (B-0360), dijadwalkan Shift Pagi pukul 08.00
> Data yang tersedia tidak membedakan cuti dan izin, dan tidak mencantumkan alasannya. Saya bisa mengeceknya lebih lanjut kalau perlu.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-008 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa yang tidak hadir tanggal 11 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily / hris_attendance_get_period_summary
- Jawaban harus memuat: "Ghofur"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.334 in / 337 out · cache r0/w0 · 4.7 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada **11 November 2026**, hanya **1 karyawan** yang tidak hadir:
> - **ACHMAD GHOFUR** (B-0348). Ia dijadwalkan masuk Shift Pagi pukul 08.00, tetapi tidak tercatat check-in maupun check-out.
> Dari 8 karyawan yang dijadwalkan masuk hari itu, 7 orang hadir (1 di antaranya terlambat). Tidak ada yang cuti atau izin.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.335 in / 351 out · cache r14.062/w1.267 · 4.8 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada **11 November 2026**, hanya **1 karyawan** yang tidak hadir:
> - **ACHMAD GHOFUR** (B-0348): dijadwalkan Shift Pagi (dummy MCP) pukul 08.00, tetapi tidak ada catatan check-in maupun check-out.
> Hari itu ada 8 karyawan yang dijadwalkan kerja. Sebanyak 7 orang hadir, termasuk 1 orang yang terlambat. Tidak ada yang cuti atau izin.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
