# Whitepaper: SISKOP — Sistem Informasi Koperasi Berbasis SaaS

**Versi:** 1.0
**Tanggal:** 26 Juli 2026
**Disusun oleh:** Riset produk internal, berdasarkan PRD v1.4.0, System Architecture v1.1.0, dan status implementasi terkini
**Audiens:** Calon pelanggan koperasi, mitra bisnis, investor, dan tim internal CV Inovasi Jaya Karsa

---

## 1. Ringkasan Eksekutif

**SISKOP** adalah platform SaaS (Software as a Service) multi-tenant yang dirancang khusus untuk mendigitalisasi operasional Koperasi Simpan Pinjam (KSP) di Indonesia — baik yang beroperasi secara **konvensional** (berbasis bunga) maupun **syariah** (berbasis bagi hasil/akad Murabahah). Setiap koperasi yang bergabung mendapatkan subdomain eksklusif (`{namakoperasi}.siskop.com`) dengan data yang sepenuhnya terisolasi dari koperasi lain, mencakup manajemen anggota, simpanan, pinjaman/pembiayaan, pelaporan keuangan, dan — sejak modul akuntansi ditambahkan — kepatuhan terhadap standar akuntansi SAK EP yang diwajibkan Permenkop UKM No. 2/2024.

SISKOP dibangun untuk menjawab kesenjangan nyata: mayoritas KSP di Indonesia masih mengandalkan pencatatan manual atau spreadsheet yang rentan kesalahan, sulit diaudit, dan tidak memberikan visibilitas real-time atas kesehatan portofolio pinjaman. Produk ini menggabungkan empat hal dalam satu sistem: **operasional harian** (simpan-pinjam), **tata kelola akses** (RBAC granular), **kepatuhan regulasi** (kategori kualitas pinjaman OJK, pelaporan SAK EP), dan **model bisnis SaaS** (paket langganan bertingkat dengan entitlement modul).

---

## 2. Masalah yang Diselesaikan

| Masalah | Dampak pada Koperasi | Solusi SISKOP |
|---|---|---|
| Pencatatan manual (buku besar fisik/spreadsheet) | Rentan human error, sulit direkonsiliasi | Sistem transaksi tersentral dengan saldo real-time |
| Tidak ada visibilitas real-time | Manajer tidak tahu kondisi keuangan sampai laporan bulanan selesai disusun | Dashboard dengan kartu ringkasan dan grafik tren |
| Tidak ada early warning tunggakan | Kredit macet baru terdeteksi setelah terlambat | Kategorisasi KOL otomatis (harian + real-time setelah tiap pembayaran) |
| Laporan RAT & keuangan sulit disusun akurat | Risiko kepatuhan terhadap anggota dan regulator | Modul laporan dengan export PDF siap cetak, plus laporan regulasi SAK EP |
| Tidak ada kolaborasi multi-user dengan peran berbeda | Satu akun dipakai bersama, tidak ada jejak audit per pengguna | RBAC granular per modul (baca/tulis/hapus/ekspor) |

---

## 3. Gambaran Produk

### 3.1 Model Multi-Tenant Berbasis Subdomain

Setiap koperasi (*tenant*) yang mendaftar mendapat subdomain eksklusif — misalnya `kopsejahtera.siskop.com` — dengan data yang diisolasi penuh di level baris database (`tenantId` pada setiap tabel data operasional). Tidak ada query yang dapat melintasi batas tenant, kecuali oleh **Platform Owner** melalui panel terpisah di `admin.siskop.com`.

```
{slug}.siskop.com        →  Portal Tenant (koperasi)
admin.siskop.com         →  Panel Platform Owner (mengelola seluruh koperasi)
```

### 3.2 Dua Jenis Koperasi dalam Satu Platform

SISKOP mendukung dua model operasi sekaligus, dipilih per-tenant saat registrasi:

- **Konvensional** — perhitungan bunga simpanan/pinjaman, angsuran dihitung dengan metode anuitas.
- **Syariah** — bagi hasil untuk simpanan, pembiayaan dengan akad Murabahah (margin flat).

Perbedaan ini memengaruhi kalkulasi angsuran, format laporan, dan terminologi yang ditampilkan — tanpa memerlukan basis kode terpisah.

### 3.3 Lima Peran Pengguna

| Peran | Cakupan Akses |
|---|---|
| **Platform Owner** (Super Admin SaaS) | Mengelola seluruh koperasi terdaftar, paket langganan, dan kesehatan platform — akses via `admin.siskop.com` |
| **Admin Koperasi** (Superadmin Tenant) | Akses penuh ke semua modul dalam koperasinya; mengelola user, role, dan konfigurasi |
| **Manajer** | Dashboard, laporan, dan persetujuan transaksi tertentu — tanpa akses kelola user/konfigurasi |
| **Teller/Pegawai** | Input transaksi harian (setoran, penarikan, pencairan, pembayaran cicilan) sesuai role yang ditetapkan admin |
| **Viewer** | Akses baca-saja untuk kebutuhan audit/pengawasan internal |

Keempat role tenant (Super Admin, Manajer, Teller, Viewer) dibuat otomatis saat koperasi mendaftar; admin koperasi tetap bebas membuat role kustom tambahan melalui *permission matrix* per modul.

---

## 4. Modul Inti

### 4.1 Autentikasi & Multi-Tenancy
Login via email/password (Google SSO tersedia sebagai opsi, dengan syarat email sudah terdaftar di tenant — tanpa auto-provisioning). Sesi menggunakan access token berumur 15 menit dan refresh token 7 hari, keduanya tersimpan sebagai cookie `httpOnly` — bukan `localStorage` — dengan mekanisme refresh otomatis saat token kedaluwarsa.

### 4.2 Dashboard
Kartu ringkasan total simpanan, pinjaman aktif, jumlah anggota aktif, angsuran bulan berjalan, dan peringatan anggota berstatus MACET, dilengkapi grafik pinjaman dan pembayaran cicilan per bulan (12 bulan terakhir). Setiap kartu dapat diklik untuk navigasi ke halaman detail terkait.

### 4.3 Manajemen Anggota
Pendaftaran anggota dengan validasi lengkap (NIK, alamat, tempat/tanggal lahir, pekerjaan, foto KTP), pencarian berdasarkan nama/NIK/ID, dan riwayat transaksi per anggota. ID Anggota dan Nomor Rekening dibuat otomatis mengikuti format terstandarisasi (`KOP-{SLUG}-{YYYYMM}-{urutan 4 digit}` dan `ACC-{10 digit acak}`). Penghapusan anggota selalu bersifat *soft delete* (nonaktifkan) — data historis tidak pernah dihapus permanen.

### 4.4 Simpanan
Konfigurasi jenis simpanan (Pokok/Wajib/Sukarela) dengan rate bunga/bagi hasil masing-masing; tiga jenis default disediakan otomatis saat registrasi tanpa bergantung pada paket langganan. Teller mencatat setoran dan penarikan, dengan saldo yang terupdate real-time. Paket langganan dapat membatasi jumlah konfigurasi simpanan *kustom* tambahan (kuota ditegakkan di backend, bukan sekadar disembunyikan di UI).

### 4.5 Pinjaman/Pembiayaan & Early-Warning KOL
Anggota harus memiliki simpanan pokok sebelum mengajukan pinjaman; sistem memberi peringatan (bukan blokir keras) jika anggota sudah memiliki pinjaman aktif. Angsuran dihitung otomatis sesuai jenis koperasi (anuitas untuk konvensional, flat untuk syariah).

Fitur unggulan modul ini adalah **kategorisasi KOL (Kualitas Obligasi Pinjaman)** otomatis, yang di-*recalculate* setiap kali ada pembayaran dan sekali sehari melalui cron job (00:05 WIB):

| Kategori | Hari Menunggak | Aksi Sistem |
|---|---|---|
| LANCAR | 0–30 hari | Tidak ada |
| DALAM_PERHATIAN | 31–90 hari | Tandai monitoring, email ke manajer |
| KURANG_LANCAR | 91–120 hari | Batasi pengajuan pinjaman baru |
| DIRAGUKAN | 121–180 hari | Eskalasi ke manajer, email ke kontak anggota |
| MACET | > 180 hari | Alert dashboard, batasi seluruh transaksi |

Threshold ini mengikuti ketentuan OJK secara default, namun **dapat dikustomisasi per tenant** — koperasi dengan kebijakan risiko berbeda dapat menyesuaikan ambang batas tanpa mengubah kode aplikasi. Halaman monitoring tunggakan (`/loans/overdue`) menampilkan seluruh anggota non-LANCAR terurut dari yang paling berisiko (MACET) ke yang paling ringan.

### 4.6 Laporan
**Laporan operasional (RPT-01/02):** laporan keuangan dan laporan RAT (Rapat Anggota Tahunan), dapat difilter berdasarkan rentang tanggal/bulanan/tahunan, diekspor ke PDF siap cetak dengan header (logo, nama, alamat, nomor pendaftaran koperasi) dan footer (nama koperasi + nomor halaman).

**Laporan regulasi SAK EP** (modul akuntansi — lihat §5): Neraca, Laporan Arus Kas, Laporan Hasil Usaha, Daftar Pembagian SHU per Anggota, dan Catatan Atas Laporan Keuangan (CALK) — dibahas rinci di bagian berikutnya.

### 4.7 Konfigurasi Sistem
Manajemen profil pengguna, user, dan *permission matrix* per modul/peran; konfigurasi jenis simpanan dan pembiayaan beserta rate; konfigurasi threshold KOL; serta **whitelabel** (branding warna, penyembunyian atribusi "Powered by SISKOP", domain kustom, identitas pengirim email) — fitur yang hanya aktif jika paket langganan tenant mengizinkannya.

### 4.8 Panel Platform Admin (Host)
Dashboard platform (total koperasi aktif, total anggota, transaksi 30 hari terakhir), daftar seluruh koperasi terdaftar dengan statistik per koperasi, aktivasi/deaktivasi koperasi, manajemen paket langganan dan modul yang tersedia per paket, pengingat tagihan otomatis, serta notifikasi in-app untuk event penting platform (koperasi baru mendaftar, koperasi diblokir karena tagihan, perubahan paket langganan).

---

## 5. Modul Akuntansi & Kepatuhan Regulasi (SAK EP)

Sejak Permenkop UKM No. 2/2024 berlaku (menggantikan PSAK 27, wajib untuk periode mulai 1 Januari 2025), koperasi di Indonesia wajib menyusun laporan keuangan mengikuti **SAK EP** (Standar Akuntansi Keuangan Entitas Privat). SISKOP menjawab kewajiban ini melalui modul akuntansi berbayar terpisah (gated oleh entitlement paket langganan), dibangun bertahap:

1. **Konfigurasi Akun (Chart of Accounts)** — bagan akun hierarkis dengan kode ter-prefiks kategori (`1-` Aset, `2-` Kewajiban, `3-` Ekuitas, `4-` Pendapatan, `5-` Beban), tervalidasi di backend. Tersedia template COA standar (20 akun) yang dapat diisi otomatis dengan satu klik. Pemetaan jenis transaksi simpanan/pinjaman ke akun debit/kredit bersifat opsional — operasional harian tetap berjalan normal tanpa akuntansi dikonfigurasi, dengan indikator kelengkapan pemetaan sebagai panduan UI, bukan gerbang keras.
2. **Mesin Jurnal Otomatis** — setiap transaksi simpanan, pencairan, dan pembayaran pinjaman diposting otomatis ke jurnal berpasangan (*double-entry*) begitu pemetaan akun tersedia, dengan penjagaan `SUM(debit) = SUM(kredit)` di setiap entri. Tidak ada input jurnal manual di versi ini — seluruh baris jurnal berasal dari transaksi yang sudah tervalidasi.
3. **Lima Laporan Regulasi**, seluruhnya dihitung *on-demand* dari saldo jurnal (bukan tabel saldo terpisah): **Neraca** (dengan self-check Aset = Kewajiban + Ekuitas), **Laporan Arus Kas** (metode langsung, dikelompokkan Operasi/Investasi/Pendanaan), **Laporan Hasil Usaha**, **Daftar Pembagian SHU per Anggota** (alokasi proporsional berdasarkan konfigurasi 4 persentase distribusi), dan **CALK** — empat yang pertama tersedia sebagai ekspor PDF siap RAT.
4. **Notifikasi ambang wajib-audit** — pemeriksaan harian otomatis terhadap modal disetor tenant dibandingkan ambang batas Rp 5 miliar (Permenkop UKM No. 2/2024 Pasal 12), memicu notifikasi platform admin bila terlampaui.

Pendekatan ini memberi koperasi jalur bertahap menuju kepatuhan penuh: mulai dari operasional simpan-pinjam yang berjalan independen, ke pemetaan akun opsional, hingga laporan regulasi lengkap — tanpa harus "big bang" migrasi sistem akuntansi.

---

## 6. Arsitektur & Teknologi

SISKOP dibangun sebagai monorepo dengan pemisahan jelas antara frontend, backend, dan tipe/utilitas bersama:

| Lapisan | Teknologi |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui, Zustand (state), React Hook Form + Zod (form & validasi), Recharts (grafik) |
| Backend | Node.js + Express + TypeScript, arsitektur Router–Controller–Service per modul |
| Database | PostgreSQL 16 via Prisma ORM (type-safe, migrasi terjaga) |
| Autentikasi | JWT (access + refresh) + bcrypt, OAuth Google via Passport.js |
| Dokumen | Puppeteer (render PDF dari template HTML) |
| Penjadwalan | node-cron (rekalkulasi KOL, pembersihan token, pengecekan ambang audit) |
| Infrastruktur | Nginx (reverse proxy, wildcard SSL, routing subdomain), Docker (PostgreSQL lokal) |

Permintaan masuk melalui Nginx dengan SSL wildcard `*.siskop.com`, diteruskan ke backend Express yang mengekstraksi slug tenant dari subdomain, memvalidasi token JWT, lalu menjalankan setiap query dengan filter `tenantId` wajib — tidak ada jalur yang memungkinkan query lintas tenant di luar panel platform admin.

---

## 7. Keamanan & Isolasi Data

- **Isolasi tenant tingkat baris** — setiap tabel data operasional (Anggota, Simpanan, Pinjaman, Transaksi, Role, User) memiliki kolom `tenantId` yang wajib difilter di setiap query.
- **Tidak ada hard delete** — Anggota, Simpanan, dan Pinjaman hanya dapat dinonaktifkan (`isActive: false`), menjaga jejak audit historis.
- **Kata sandi** di-hash dengan bcrypt (cost factor ≥ 12); rate limiting pada endpoint login (maksimum 10 percobaan/menit).
- **Cookie httpOnly** untuk token — bukan `localStorage` — mengurangi risiko pencurian token via XSS.
- **HTTP security headers** (Helmet): `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`.
- **Validasi input** menyeluruh dengan Zod di setiap endpoint sebelum masuk ke lapisan bisnis; SQL injection secara struktural tidak mungkin karena seluruh akses data melalui Prisma ORM (parameterized query).

---

## 8. Model Bisnis: Paket Langganan Bergranular

Berbeda dari model SaaS yang hanya menyalakan/mematikan modul secara biner, SISKOP mengontrol **batas dan sub-fitur di dalam modul**:

- Setiap koperasi otomatis mendapat 3 jenis simpanan default terlepas dari paket yang dipilih — fitur inti tidak pernah terkunci di belakang paywall.
- Paket dapat menetapkan kuota jumlah konfigurasi simpanan kustom tambahan, ditegakkan di backend (bukan hanya disembunyikan di UI).
- Fitur whitelabel (branding, domain kustom, identitas pengirim email) dapat diaktifkan/nonaktifkan per paket.
- Modul akuntansi (Konfigurasi Akun + laporan regulasi SAK EP) adalah modul berbayar terpisah yang di-gate melalui entitlement paket.
- **Downgrade yang aman-data** — bila paket koperasi diturunkan hingga di bawah kuota yang sedang dipakai, data yang melebihi kuota tidak dihapus, melainkan dibekukan (read-only) dan otomatis aktif kembali bila koperasi naik paket lagi.

Platform Owner mengelola siklus tagihan per koperasi dengan pengingat otomatis (30 hari dan 7 hari sebelum jatuh tempo) dan pemblokiran akses otomatis bila tagihan melewati jatuh tempo — dapat dibuka kembali kapan saja dengan memperbarui tanggal tagihan.

---

## 9. Target Kinerja & Skalabilitas

| Aspek | Target |
|---|---|
| Waktu muat dashboard | < 3 detik pada koneksi 10 Mbps |
| Waktu respons API | < 500 ms untuk operasi standar |
| Waktu pembuatan PDF | < 10 detik |
| Uptime platform | ≥ 99,5% (downtime maksimum ~3,6 jam/bulan) |
| Kapasitas platform | Hingga 1.000 koperasi terdaftar |
| Kapasitas per koperasi | Hingga 10.000 anggota |
| Bahasa & format | Antarmuka Bahasa Indonesia; mata uang Rupiah; tanggal format `DD MMMM YYYY` |

---

## 10. Status Implementasi & Cakupan Saat Ini

Per dokumentasi terkini, seluruh modul inti (autentikasi, dashboard, anggota, simpanan, pinjaman/KOL, laporan operasional, konfigurasi, panel platform admin) telah diimplementasikan dan diuji. Modul akuntansi regulasi (Konfigurasi Akun, mesin jurnal, Neraca, Arus Kas, Laporan Hasil Usaha, Daftar Pembagian SHU, CALK) telah dibangun bertahap dengan cakupan pengujian otomatis yang berkembang seiring setiap tahap, termasuk ekspor PDF untuk empat dari lima laporan regulasi.

**Item yang secara eksplisit belum masuk cakupan v1:**
- Aplikasi mobile (iOS/Android) — direncanakan v2.0
- Integrasi payment gateway untuk pembayaran online
- Notifikasi SMS/WhatsApp otomatis
- Laporan Promosi Ekonomi Anggota (LPEA) — menunggu spesifikasi kalkulasi terpisah
- API publik untuk integrasi pihak ketiga
- Dukungan multi-bahasa (di luar Bahasa Indonesia)
- Login Google SSO — infrastruktur OAuth telah disiapkan, namun endpoint masih placeholder
- Verifikasi domain kustom otomatis (DNS/CNAME) dan provisioning sertifikat SSL per-domain untuk fitur whitelabel

---

## 11. Kesimpulan

SISKOP memposisikan diri bukan sekadar sebagai alat pencatatan simpan-pinjam digital, melainkan sebagai **platform kepatuhan dan tata kelola** untuk koperasi simpan pinjam Indonesia — menggabungkan operasional harian, deteksi dini risiko kredit (KOL), dan jalur bertahap menuju pelaporan keuangan SAK EP yang diwajibkan regulator, seluruhnya dalam arsitektur multi-tenant yang aman dan dapat diskalakan hingga ribuan koperasi. Model paket langganan bergranular memungkinkan koperasi kecil memulai dengan fitur inti tanpa biaya berlebih, sambil menyediakan jalur upgrade yang jelas menuju kepatuhan akuntansi penuh seiring pertumbuhan koperasi.

---

## 12. Sumber

Dokumen ini disusun dari `docs/01-PRD-SISKOP.md` (v1.4.0), `docs/04-System-Architecture-SISKOP.md` (v1.1.0), `docs/api-conventions.md`, `docs/kol-categories.md`, `docs/HANDOFF.md`, dan spesifikasi desain di `docs/specs/`. Merefleksikan status implementasi per 26 Juli 2026 — rujuk dokumen sumber untuk detail teknis terkini karena beberapa item pada §10 dapat berubah seiring pengembangan berlanjut.
