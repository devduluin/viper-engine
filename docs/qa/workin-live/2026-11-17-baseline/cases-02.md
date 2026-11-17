# QA Workin live: baseline 17 November 2026 (prompt cache off vs on): detail 2/7

Kembali ke [ringkasan](README.md).

## WL-009 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Bagaimana jadwal kerja Ardi Mahendra dari 17 sampai 21 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_get_schedule
- Jawaban harus memuat: "08:00" atau "08.00"
- Jawaban harus memuat: "17:00" atau "17.00"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.851 in / 649 out · cache r0/w0 · 7.9 dtk

- Tool dipanggil: hris_attendance_get_schedule

> Ardi Mahendra (D-0005) dijadwalkan bekerja **setiap hari dari 17 sampai 21 November 2026**. Tidak ada hari libur dan semua tanggal sudah punya jadwal.
> | Tanggal | Hari | Shift | Jam kerja |
> |---|---|---|---|
> | 17 Nov | Selasa | Shift Pagi | 08:00–17:00 |
> | 18 Nov | Rabu | Shift Pagi | 08:00–17:00 |
> | 19 Nov | Kamis | Shift Pagi | 08:00–17:00 |
> | 20 Nov | Jumat | Shift Pagi | 08:00–17:00 |
> | 21 Nov | Sabtu | Shift Pagi | 08:00–17:00 |
> Aturannya sama setiap hari: check-in mulai pukul 07:00 dan batas terlambat 15 menit.
> **Perlu dicek:**
> - Nama shift di sistem tertulis "Shift Pagi (dummy MCP)", jadi kemungkinan ini data uji.
> - Ardi juga dijadwalkan masuk hari Sabtu, 21 November. Pastikan memang begitu kalau Sabtu biasanya hari libur.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.851 in / 755 out · cache r14.076/w1.769 · 8.7 dtk

- Tool dipanggil: hris_attendance_get_schedule

> Ardi Mahendra (D-0005) dijadwalkan bekerja **5 hari penuh** dari 17 sampai 21 November 2026. Tidak ada hari libur atau hari tanpa jadwal di rentang ini.
> | Tanggal | Hari | Shift | Jam kerja |
> |---|---|---|---|
> | 17 Nov 2026 | Selasa | Shift Pagi | 08:00–17:00 |
> | 18 Nov 2026 | Rabu | Shift Pagi | 08:00–17:00 |
> | 19 Nov 2026 | Kamis | Shift Pagi | 08:00–17:00 |
> | 20 Nov 2026 | Jumat | Shift Pagi | 08:00–17:00 |
> | 21 Nov 2026 | Sabtu | Shift Pagi | 08:00–17:00 |
> Setiap hari, check-in sudah bisa dilakukan mulai pukul 07:00. Batas terlambatnya 15 menit, jadi Ardi masih tepat waktu kalau check-in sebelum 08:15.
> **Perlu dicek:**
> - Di sistem, nama shift ini tercatat sebagai **"Shift Pagi (dummy MCP)"**. Sebaiknya pastikan ini memang shift resmi, bukan data uji coba.
> - Ardi juga dijadwalkan masuk pada **hari Sabtu, 21 November**. Pastikan memang ada jadwal kerja hari Sabtu.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-010 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Pengajuan kehadiran apa saja yang masih menunggu persetujuan di bulan November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_search_requests
- Jawaban harus memuat: "lembur" atau "overtime"
- Jawaban harus memuat: "tukar shift" atau "tukar_shift" atau "shift swap"
- Jawaban tidak boleh memuat: "renovasi"
- Tidak boleh ada permintaan approval
- Catatan dataset: The approved WFH request must not be listed as pending.

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.429 in / 470 out · cache r0/w0 · 6.2 dtk

- Tool dipanggil: hris_attendance_search_requests

> Ada **2 pengajuan kehadiran** di bulan November 2026 yang masih menunggu persetujuan. Keduanya diajukan pada 17 Nov 2026 pukul 16.34.
> | Karyawan | Jenis | Tanggal | Keterangan |
> |---|---|---|---|
> | Agus Setiawan (D-0013) | Lembur | 18 Nov 2026 | Lembur closing bulanan |
> | Ahmad Qayyim (B-0432) | Tukar shift | 19 Nov 2026 | Tukar shift dengan rekan |
> Lembur Agus jatuh **besok**, jadi sebaiknya diproses lebih dulu.
> Di keterangan kedua pengajuan ada tulisan "(dummy MCP)". Sebaiknya cek dulu apakah ini pengajuan asli atau hanya data uji coba.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.429 in / 485 out · cache r14.075/w1.348 · 9.0 dtk

- Tool dipanggil: hris_attendance_search_requests

> Ada **2 pengajuan kehadiran** di November 2026 yang masih menunggu persetujuan:
> | No | Karyawan | Jenis | Tanggal | Keterangan |
> |---|---|---|---|---|
> | 1 | Agus Setiawan (D-0013) | Lembur | 18 Nov 2026 | Lembur closing bulanan |
> | 2 | Ahmad Qayyim (B-0432) | Tukar shift | 19 Nov 2026 | Tukar shift dengan rekan |
> Keduanya diajukan hari ini (17 Nov 2026) pukul 16.34 dan sudah harus diputuskan dalam 1–2 hari ke depan.
> Catatan: keterangan kedua pengajuan ini diberi label "(dummy MCP)", jadi kemungkinan ini data uji coba, bukan pengajuan sungguhan.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-011 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Siapa yang bekerja dari rumah (WFH) tanggal 12 November 2026?

**Yang diharapkan**

- Status yang diterima: completed
- Minimal salah satu tool: hris_attendance_search_requests / hris_attendance_search_daily
- Jawaban harus memuat: "adas" atau "silalahi"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 15.049 in / 464 out · cache r0/w0 · 6.0 dtk

- Tool dipanggil: hris_attendance_search_requests

> Hanya **1 karyawan** yang tercatat WFH pada **12 November 2026**:
> | Nama | Kode | Status | Alasan |
> |---|---|---|---|
> | adas silalahi | TESTING | Disetujui | WFH karena renovasi rumah |
> Hal yang perlu diperhatikan:
> - **Ini mungkin data uji coba.** Kodenya "TESTING" dan alasannya bertanda "(dummy MCP)".
> - **Diajukan setelah tanggalnya.** Pengajuan ini dibuat pada 17 November 2026 untuk tanggal 12 November.
> - **Sumber datanya hanya pengajuan WFH di sistem.** Karyawan yang WFH tanpa membuat pengajuan tidak akan muncul di sini.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 15.070 in / 432 out · cache r14.070/w994 · 7.1 dtk

- Tool dipanggil: hris_attendance_search_requests

> Pada **12 November 2026**, hanya ada **1 karyawan** yang tercatat WFH:
> | Nama | Kode | Status | Alasan |
> |---|---|---|---|
> | adas silalahi | TESTING | Disetujui | WFH karena renovasi rumah |
> Catatan:
> - Pengajuan ini baru diajukan hari ini (17 November 2026), jadi dibuat setelah tanggal WFH-nya.
> - Kode karyawan "TESTING" dan alasan yang bertuliskan "(dummy MCP)" menunjukkan ini mungkin data uji coba, bukan WFH sungguhan.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-012 · multi_step · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Buatkan rekap ketidakhadiran dan cuti karyawan untuk periode 10 sampai 14 November 2026.

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_get_period_summary
- Jawaban harus memuat: "Ghofur"
- Jawaban harus memuat: "Fathoni"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 21.066 in / 825 out · cache r0/w0 · 12.3 dtk

- Tool dipanggil: hris_attendance_get_period_summary

> ## Rekap Ketidakhadiran & Cuti, 10–14 November 2026
> Ada 8 karyawan yang terjadwal, dengan total 40 hari kerja terjadwal:
> | Kategori | Jumlah hari |
> |---|---|
> | Hadir | 37 |
> | Tidak hadir (tercatat absen) | 1 |
> | Cuti/izin | 2 |
> | Hari kerja tanpa data kehadiran | 0 |
> **Karyawan yang tidak hadir atau cuti:**
> | Karyawan | Kode | Tanggal | Status | Alasan |
> |---|---|---|---|---|
> | ACHMAD GHOFUR | B-0348 | 11 Nov | Tidak hadir | Tidak dicatat |
> … (baris berikutnya dipotong)

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 21.066 in / 611 out · cache r14.082/w6.978 · 8.2 dtk

- Tool dipanggil: hris_attendance_get_period_summary

> **Rekap ketidakhadiran dan cuti: 10–14 November 2026**
> **Ringkasan (8 karyawan, 40 hari terjadwal)**
> - Hadir: 37 hari
> - Absen: 1 hari
> - Cuti/izin: 2 hari
> - Hari kerja tanpa catatan kehadiran: 0
> **Rinciannya**
> | Karyawan | Kode | Tanggal | Status | Keterangan |
> |---|---|---|---|---|
> | ACHMAD GHOFUR | B-0348 | 11 Nov 2026 | Absen | Tidak ada alasan tercatat |
> | ACHMAD FATHONI | B-0360 | 13–14 Nov 2026 | Cuti | Cuti tahunan |
> Enam karyawan lainnya hadir penuh 5/5 hari: Ahmad Qayyim, Ardi Mahendra, Agung Setyo, Abraham Gamaliel Figrana, Agus Setiawan, dan adas silalahi.
> … (baris berikutnya dipotong)

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-013 · tools · cache-off ✅ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Tipe shift apa saja yang tersedia dan jam berapa Shift Pagi dimulai?

**Yang diharapkan**

- Status yang diterima: completed
- Tool wajib dipanggil: hris_attendance_list_shift_types
- Jawaban harus memuat: "08:00" atau "08.00"
- Tidak boleh ada permintaan approval

**cache-off**: ✅ PASS · status `completed` · 2 model call · token 16.992 in / 668 out · cache r0/w0 · 8.3 dtk

- Tool dipanggil: hris_attendance_list_shift_types

> Ada **12 tipe shift** di Workin:
> | Shift | Jam | Toleransi telat |
> |---|---|---|
> | aaaa (kode: a) | 09:06–21:06 | 0 menit |
> | Early Morning Shift | 03:02–07:02 | 15 menit |
> | Evening Shift | 17:00–22:07 | 30 menit |
> | Half Day | 09:00–12:01 | 15 menit |
> | Morning Shift | 09:00–17:00 | 120 menit |
> | Night Shift | 17:30–23:58 | 15 menit |
> | Saturday Shift | 09:00–14:00 | 30 menit |
> | Shift Malam | 20:00–03:00 (lewat tengah malam) | 60 menit |
> | Shift Pagi (dummy MCP) (kode: DMCP) | 08:00–17:00 | 15 menit |
> … (baris berikutnya dipotong)

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 16.992 in / 628 out · cache r14.073/w2.913 · 8.4 dtk

- Tool dipanggil: hris_attendance_list_shift_types

> Ada **12 tipe shift**:
> | Shift | Jam | Toleransi telat |
> |---|---|---|
> | aaaa (kode a) | 09:06–21:06 | 0 menit |
> | Early Morning Shift | 03:02–07:02 | 15 menit |
> | Evening Shift | 17:00–22:07 | 30 menit |
> | Half Day | 09:00–12:01 | 15 menit |
> | Morning Shift | 09:00–17:00 | 120 menit |
> | Night Shift | 17:30–23:58 | 15 menit |
> | Saturday Shift | 09:00–14:00 | 30 menit |
> | Shift Malam | 20:00–03:00 (hari berikutnya) | 60 menit |
> | Shift Pagi (dummy MCP) (kode DMCP) | 08:00–17:00 | 15 menit |
> … (baris berikutnya dipotong)

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 

## WL-014 · approval · cache-off ❌ · cache-on ✅ · cache-on-ulang —

**Pertanyaan:** Tolong buatkan jadwal Shift Pagi (dummy MCP) untuk Agus Setiawan tanggal 24 November 2026.

**Yang diharapkan**

- Status yang diterima: completed / partial
- Jawaban harus memuat: "ditolak" atau "tidak disetujui" atau "menolak" atau "tidak menyetujui" atau "dibatalkan"
- Jawaban tidak boleh memuat: "berhasil dibuat", "sudah dibuat", "telah dibuat", "hak akses", "minta akses", "meminta akses", "belum punya hak", "tidak punya izin", "tidak memiliki izin", "kebijakan izin"
- Approval wajib diminta untuk hris_attendance_create_schedule (keputusan runner: TOLAK)
- Catatan dataset: Approval must be requested; the runner (the user) rejects it. The answer must say the request was declined and must not claim the schedule exists or blame missing permissions.

**cache-off**: ❌ FAIL · status `completed` · 2 model call · token 14.454 in / 304 out · cache r0/w0 · 5.0 dtk

- Tool dipanggil: hris_attendance_create_schedule
- Approval diminta: hris_attendance_create_schedule
- Alasan gagal: answer lacks ditolak|tidak disetujui|menolak|tidak menyetujui|dibatalkan

> Jadwal Shift Pagi (dummy MCP) untuk Agus Setiawan pada 24 November 2026 belum dibuat karena permintaannya Anda tolak saat konfirmasi. Belum ada data jadwal yang berubah.
> Kalau ingin melanjutkan atau mengubah tanggal atau tipe shift, beri tahu saya.

**cache-on**: ✅ PASS · status `completed` · 2 model call · token 14.454 in / 333 out · cache r14.088/w360 · 5.4 dtk

- Tool dipanggil: hris_attendance_create_schedule
- Approval diminta: hris_attendance_create_schedule

> Jadwal Shift Pagi (dummy MCP) untuk Agus Setiawan tanggal 24 November 2026 belum dibuat. Pembuatannya ditolak saat diminta konfirmasi, jadi tidak ada perubahan pada jadwalnya.
> Saya tidak akan mencobanya lagi kecuali Anda memintanya. Kalau ingin mengubah tanggal atau tipe shift, beri tahu saya.

**cache-on-ulang**: tidak dijalankan

- [ ] Reviewer: jawaban benar dan pantas untuk pengguna
- Catatan reviewer: 
