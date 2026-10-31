# Runbook: Migrasi Koperasi (Platform Admin)

Untuk platform owner yang memigrasi koperasi lewat menu **Migrasi koperasi** (`/platform/migration`).
Acuan kolom dan tabel tujuan: `MIGRATION-FIELD-MAPPING.md`.

## Sebelum mulai

1. **Backup database** tujuan (migrasi menulis banyak tabel dalam satu transaksi; pemulihan setelah commit = hapus tenant, lihat "Bila migrasi salah").
2. Pastikan backend yang dipakai menunjuk database yang dimaksud. `apps/backend/.env` bisa menunjuk staging; periksa `DATABASE_URL` sebelum menjalankan di mesin lokal.
3. Pilih template:
   - **Template Sistem**: koperasi punya data rinci dari sistem lama (daftar anggota, saldo simpanan, pinjaman, neraca saldo).
   - **Template Laporan**: koperasi hanya punya Neraca dan lampiran RAT. Pinjaman bersifat estimasi.
4. Identitas anggota (NIK 16 digit, alamat, tempat dan tanggal lahir, pekerjaan) tetap wajib di kedua template. Jangan menyetujui NIK sementara.

## Langkah

1. Buka **Migrasi koperasi**, unduh template yang sesuai, kirim ke admin koperasi.
2. Admin mengisi sheet dari 1 sampai 10 sesuai sheet PETUNJUK dan mengembalikan file lewat jalur aman (file memuat data pribadi).
3. Unggah file dan klik **Pratinjau** (langkah 1 hanya butuh file). Tidak ada yang tersimpan.
4. Bila ada kesalahan: klik **Unduh laporan untuk koperasi (CSV)** atau **Salin ringkasan**, kirim ke admin. Nomor baris di laporan sama dengan nomor baris di file Excel mereka. Ulangi dari langkah 3 dengan file perbaikan.
   Koperasi tujuan dipilih di langkah **Pratinjau**, bukan saat mengunggah: **Koperasi baru** (default, dibuat dari sheet 1) atau **Koperasi yang sudah terdaftar** (cari nama, subdomain, atau no. badan hukum). Mengganti tujuan menjalankan pemeriksaan ulang otomatis; hasil lama diredupkan dan Eksekusi nonaktif sampai pemeriksaan selesai. Koperasi terdaftar harus masih kosong dan subdomain di file harus sama. Bila pratinjau melaporkan "Subdomain sudah dipakai", koperasi itu mungkin sudah terdaftar: pilih sebagai tujuan.
5. Bila pratinjau bersih: periksa kartu total dan tabel jurnal "Saldo Awal Migrasi" bersama admin. Peringatan "Rekonsiliasi" berarti total simpanan atau pinjaman di sheet 5/7 berbeda dari akun di neraca (sheet 9); minta admin menjelaskannya sebelum lanjut.
6. Untuk koperasi baru, isi kata sandi admin (min. 8 karakter); untuk koperasi terdaftar tidak ada kata sandi (admin yang ada dipakai). Klik **Eksekusi migrasi**. Seluruh data masuk dalam satu transaksi: berhasil semua atau tidak sama sekali.
7. Serahkan kata sandi admin lewat jalur aman; kata sandi tidak disimpan di file maupun log.
8. Atur paket langganan di halaman **Koperasi** (migrasi tidak mengimpor paket).
9. Minta admin login di subdomain koperasi dan mencocokkan: jumlah anggota, total simpanan per tipe, total sisa pinjaman, dan Neraca per tanggal cut-off dengan sistem lama atau Neraca RAT.

## Pesan kesalahan umum

| Pesan | Penyebab | Perbaikan |
|---|---|---|
| Kolom ini tersimpan sebagai angka (kolom `nik`) | Excel mengubah NIK jadi angka dan memotong digit terakhir | Ubah format kolom jadi Teks, ketik ulang NIK |
| Sel berisi rumus | Sel berisi `=...` | Salin sebagai nilai (Paste Special > Values) |
| NIK X tidak ada di 3_Anggota | Sheet 5 atau 7 merujuk NIK yang belum didaftar | Tambahkan anggota atau perbaiki NIK |
| Anggota belum punya simpanan pokok | Pinjaman diminta untuk anggota tanpa simpanan Pokok | Tambah baris Pokok di sheet 5 |
| Neraca saldo tidak seimbang | Total debit tidak sama dengan kredit | Periksa baris sheet 9; di template Laporan, pengurang ditulis sesuai aturan tanda |
| Subdomain X sudah dipakai | Slug sudah ada (mode koperasi baru) | Ganti `slug` di sheet 1, atau pilih tujuan Koperasi yang sudah terdaftar |
| Koperasi tujuan sudah berisi data | Tujuan punya anggota/simpanan/pinjaman/jurnal | Pilih koperasi kosong; yang sudah berisi tidak didukung |
| Subdomain di file berbeda dari koperasi tujuan | File untuk koperasi lain | Pilih koperasi yang benar atau perbaiki `slug` di sheet 1 |
| Koperasi tujuan belum punya admin aktif | Tidak ada user Super Admin aktif | Buat admin lewat halaman Koperasi, lalu ulangi |
| File berbeda dari yang dipratinjau | File berubah setelah pratinjau | Unggah dan pratinjau ulang |

## Batas dan performa

- File maksimal 10 MB, maksimal 20.000 baris per sheet.
- Proses berjalan dalam satu request. **Terukur (DB uji lokal):** 5.000 anggota + 5.000 rekening simpanan + 1.500 pinjaman membutuhkan sekitar 166 detik untuk pratinjau dan 154 detik untuk eksekusi (sekitar 25 ms per baris simpanan/pinjaman karena tiap baris dijurnal sendiri).
- Pedoman: sampai kira-kira 1.000 rekening simpanan + 300 pinjaman selesai di bawah 40 detik. Di atas itu waktu tunggu bergantung pada batas waktu proxy/load balancer di lingkungan tujuan. Untuk koperasi besar, jalankan di lingkungan dengan batas waktu >= 5 menit atau tunggu optimasi jurnal massal.

## Bila migrasi salah

Migrasi yang sudah di-commit tidak bisa dibatalkan dari UI. Pemulihan:

1. Dapatkan persetujuan pemilik platform.
2. Hapus tenant hasil migrasi lewat prosedur ops (penghapusan tenant meng-cascade semua tabel milik tenant, termasuk slug cadangan).
3. Perbaiki file, ulangi dari pratinjau.

## Akun admin (Firebase)

Bila `FIREBASE_ACCOUNT_PROVISIONING_ENABLED=true`, eksekusi membuat akun Firebase sebelum transaksi database. Jika transaksi gagal, akun Firebase yang sudah dibuat ditandai `CLEANUP_REQUIRED` dan dibersihkan oleh job rekonsiliasi `IdentityProvisioner.reconcile` (jeda 15 menit). Pratinjau tidak pernah membuat akun Firebase.
