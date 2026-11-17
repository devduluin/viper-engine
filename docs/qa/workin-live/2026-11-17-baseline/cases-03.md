# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 3/7

Kembali ke [ringkasan](README.md).

## WL-015 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Berapa karyawan aktif yang berulang tahun di bulan Mei?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_list_birthdays
- Jawaban harus memuat: "20"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 21.292 in / 872 out · cache r0/w0 · 10.6 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **20 karyawan aktif** yang berulang tahun di bulan Mei.
> | Tgl | Nama | Kode | Usia yang dicapai |
> |---|---|---|---|
> | 1 | Unang Sodikin | D-0012 | 33 |
> | 7 | perski mak | ID-19239 | 1 ⚠️ |
> | 9 | Muhammad Rafi Irfansyah | D-0040 | 26 |
> | 11 | ACHMAD FATHONI | B-0360 | 28 |
> | 11 | M HAIKAL FAKHREZI | B-0356 | 22 |
> | 16 | SUWARDI SUWARDI | B-0371 | 40 |
> | 17 | Fania Isfandiari Arifah | D-0016 | 33 |
> | 20 | Irfan Choiruddin Anwar | D-0036 | 25 |
> | 21 | AGUNG SETYO | B-0358 | 25 |
> … (baris berikutnya dipotong)

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 21.292 in / 1.073 out · cache r14.065/w7.221 · 22.0 dtk

- Tool dipanggil: hris_employees_list_birthdays

> Ada **20 karyawan aktif** yang berulang tahun di bulan Mei.
> | Tgl | Nama | Kode |
> |---|---|---|
> | 1 | Unang Sodikin | D-0012 |
> | 7 | perski mak | ID-19239 |
> | 9 | Muhammad Rafi Irfansyah | D-0040 |
> | 11 | ACHMAD FATHONI | B-0360 |
> | 11 | M HAIKAL FAKHREZI | B-0356 |
> | 16 | SUWARDI SUWARDI | B-0371 |
> | 17 | Fania Isfandiari Arifah | D-0016 |
> | 20 | Irfan Choiruddin Anwar | D-0036 |
> | 21 | AGUNG SETYO | B-0358 |
> … (baris berikutnya dipotong)

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-016 · multi_step · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Sudah berapa lama Ardi Mahendra bekerja di perusahaan, dan apakah dia terlambat pada 12 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_employees_get_profile, hris_attendance_search_daily
- Jawaban harus memuat: "3 tahun"
- Jawaban harus memuat: "25 menit"
- Tidak boleh ada permintaan approval
- Catatan dataset: Needs both services (employees + attendance) in one run.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 16.164 in / 510 out · cache r0/w0 · 6.7 dtk

- Tool dipanggil: hris_employees_get_profile → hris_attendance_search_daily

> **Masa kerja:** Ardi Mahendra (D-0005) sudah bekerja sekitar **3 tahun**. Dia mulai bergabung pada 8 November 2023.
> **Kehadiran 12 November 2026:** Ya, Ardi **terlambat**.
> - Shift: Shift Pagi, mulai pukul 08.00, dengan toleransi 15 menit
> - Masuk pukul **08.25**, jadi terlambat **25 menit** dari jam mulai. Itu 10 menit melewati batas toleransi.
> - Pulang pukul 17.05

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 16.139 in / 351 out · cache r14.088/w2.045 · 4.7 dtk

- Tool dipanggil: hris_employees_get_profile → hris_attendance_search_daily

> Ardi Mahendra (D-0005) sudah bekerja **3 tahun 0 bulan**. Dia bergabung pada 8 November 2023.
> **Pada 12 November 2026, Ardi terlambat.**
> - **Shift:** Shift Pagi, mulai 08:00, toleransi 15 menit
> - **Check-in:** 08:25, tercatat **terlambat 25 menit**
> - **Check-out:** 17:05

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-017 · error · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Kapan tanggal lahir karyawan bernama Zulkarnain Xyz?

**Yang diharapkan**

- Status yang diterima: completed / partial
- Minimal salah satu tool: hris_employees_get_profile / hris_employees_search
- Jawaban harus memuat: "tidak ditemukan" atau "tidak ada" atau "tidak menemukan" atau "belum terdaftar"
- Jawaban tidak boleh memuat: "lahir pada", "lahir di"
- Tidak boleh ada permintaan approval
- Catatan dataset: No such employee: the answer must say so and must not invent a date.

**cache-off**: ✅ PASS · status `partial` · 3 model call · token 22.160 in / 370 out · cache r0/w0 · 6.8 dtk

- Tool dipanggil: hris_employees_get_profile → hris_employees_search

> Tanggal lahirnya tidak bisa saya temukan karena tidak ada karyawan bernama **Zulkarnain Xyz** di Workin. Pencarian dengan nama "Zulkarnain" saja juga tidak menemukan hasil, termasuk untuk karyawan nonaktif dan yang sudah keluar.
> Mungkin ada beda ejaan, misalnya "Zulkarnaen" atau "Dzulkarnain". Kalau Anda punya ejaan lain, kode, NIK, atau ID karyawannya, kirimkan saja dan saya cari lagi.

**cache-on**: ✅ PASS · status `partial` · 3 model call · token 22.160 in / 337 out · cache r21.405/w747 · 6.1 dtk

- Tool dipanggil: hris_employees_get_profile → hris_employees_search

> Saya tidak bisa menemukan tanggal lahirnya karena tidak ada karyawan bernama **Zulkarnain Xyz** di Workin. Saya juga sudah mencari nama "Zulkarnain" saja, termasuk karyawan aktif, nonaktif, dan yang sudah keluar, tetapi tidak ada yang cocok.
> Kalau ada, kirimkan ejaan lain dari namanya atau kode/NIK karyawannya, nanti saya cek lagi.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-018 · multi_turn · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan 1:** Kapan ulang tahun Ardi?

**Pertanyaan 2:** Maksud saya Ardik Susilo.

**Yang diharapkan**

- Status yang diterima: completed / partial
- Tool wajib dipanggil: hris_employees_get_profile
- Jawaban harus memuat: "1970"
- Tidak boleh ada permintaan approval
- Catatan dataset: Clarification answered in the second turn. Ardik Susilo's recorded birth date is 1970-01-01 (placeholder in dev data); flagging it as suspicious is fine.

**cache-off**: ✅ PASS · status `completed` · 4 model call · token 35.196 in / 708 out · cache r0/w0 · 14.6 dtk

- Tool dipanggil: hris_employees_get_profile → hris_employees_get_profile

> Di sistem, **ulang tahun Ardik Susilo** (2024010201191302102) tercatat **1 Januari**, dengan tanggal lahir 1 Januari 1970.
> Tapi data ini kemungkinan belum diisi dengan benar. Tanggal bergabungnya juga 1 Januari 1970. 1 Januari 1970 sering muncul sebagai nilai bawaan saat data kosong. Sebaiknya tanggal lahir Ardik dicek ulang lalu diperbarui di profilnya.

**cache-on**: ✅ PASS · status `completed` · 4 model call · token 35.328 in / 841 out · cache r32.362/w2.954 · 13.3 dtk

- Tool dipanggil: hris_employees_get_profile → hris_employees_get_profile

> Di sistem, tanggal lahir **Ardik Susilo** (2024010201191302102) tercatat **1 Januari 1970**. Kalau benar, ulang tahun berikutnya jatuh pada 1 Januari 2027.
> Tapi tanggal ini kemungkinan besar belum diisi dengan benar. Tanggal bergabungnya juga tercatat 1 Januari 1970, padahal kode karyawannya diawali 2024. 1 Januari 1970 juga sering muncul sebagai nilai bawaan sistem kalau datanya kosong. Sebaiknya cek ulang dan perbarui tanggal lahir serta tanggal bergabungnya di profil karyawan.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-019 · multi_turn · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan 1:** Siapa yang terlambat masuk kerja pada 12 November 2026?

**Pertanyaan 2:** Berapa menit keterlambatan masing-masing?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_search_daily
- Jawaban harus memuat: "25"
- Jawaban harus memuat: "36"
- Tidak boleh ada permintaan approval
- Catatan dataset: Follow-up refers to the previous answer (Ardi 25 min, Abraham 36 min on 12 Nov).

**cache-off**: ✅ PASS · status `completed` · 3 model call · token 24.412 in / 535 out · cache r0/w0 · 7.8 dtk

- Tool dipanggil: hris_attendance_search_daily

> Pada 12 November 2026:
> - **Abraham Gamaliel Figrana** terlambat **36 menit** (check-in 08:36)
> - **Ardi Mahendra** terlambat **25 menit** (check-in 08:25)
> Keterlambatan ini dihitung dari jam mulai shift pukul 08:00, bukan dari batas toleransi pukul 08:15.

**cache-on**: ✅ PASS · status `completed` · 3 model call · token 24.409 in / 570 out · cache r21.145/w3.254 · 8.2 dtk

- Tool dipanggil: hris_attendance_search_daily

> Keterlambatan masing-masing pada 12 November 2026:
> - **Abraham Gamaliel Figrana**: **36 menit** (masuk pukul 08:36)
> - **Ardi Mahendra**: **25 menit** (masuk pukul 08:25)
> Keterlambatan ini dihitung dari jam mulai shift, yaitu 08:00. Kalau dihitung setelah toleransi 15 menit, Abraham lewat 21 menit dan Ardi lewat 10 menit.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-020 · multi_turn · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan 1:** Berapa karyawan yang hadir pada 11 November 2026?

**Pertanyaan 2:** Maaf, maksud saya tanggal 13 November 2026.

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_daily / hris_attendance_get_today_summary
- Jawaban harus memuat: "7"
- Tidak boleh ada permintaan approval
- Catatan dataset: User corrects the date; 13 Nov: 7 present, 1 on leave.

**cache-off**: ✅ PASS · status `completed` · 4 model call · token 30.996 in / 361 out · cache r0/w0 · 6.8 dtk

- Tool dipanggil: hris_attendance_get_today_summary → hris_attendance_get_today_summary

> Pada 13 November 2026 juga ada **7 karyawan yang hadir** dari 8 yang dijadwalkan kerja.
> - **Hadir:** 7 orang. 1 di antaranya datang terlambat.
> - **Cuti/izin:** 1 orang
> - **Tidak hadir:** tidak ada

**cache-on**: ✅ PASS · status `completed` · 4 model call · token 31.116 in / 478 out · cache r29.012/w2.092 · 7.8 dtk

- Tool dipanggil: hris_attendance_get_today_summary → hris_attendance_get_today_summary

> Pada 13 November 2026, **7 dari 8 karyawan** yang dijadwalkan kerja hadir.
> - **Hadir:** 7 orang. Dari jumlah ini, 1 orang datang terlambat.
> - **Cuti atau izin:** 1 orang
> - **Tidak hadir:** 0
> Tanggal itu bukan hari libur. Saya bisa menampilkan nama karyawan yang terlambat dan yang cuti/izin kalau Anda perlu.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
