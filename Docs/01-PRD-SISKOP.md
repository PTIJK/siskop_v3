# Product Requirements Document (PRD)
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Versi** | 1.4.0 |
| **Tanggal** | 21 Juli 2026 |
| **Status** | Draft — disinkronkan dengan implementasi berjalan |
| **Pemilik Produk** | CV Inovasi Jaya Karsa |

---

## 1. Executive Summary

SISKOP adalah platform SaaS (Software as a Service) multi-tenant yang dirancang khusus untuk mendigitalisasi operasional Koperasi Simpan Pinjam (KSP) di Indonesia — baik konvensional maupun syariah. Platform ini memungkinkan setiap koperasi memiliki sistem manajemen anggota, simpanan, pinjaman/pembiayaan, dan laporan keuangan yang terintegrasi, dapat diakses melalui subdomain eksklusif masing-masing.

---

## 2. Problem Statement

Mayoritas Koperasi Simpan Pinjam di Indonesia masih beroperasi secara manual atau menggunakan sistem yang tidak terintegrasi (spreadsheet, buku besar fisik). Hal ini menyebabkan:

- **Inefisiensi operasional** — pencatatan manual rentan error dan memakan waktu
- **Kesulitan monitoring** — tidak ada visibilitas real-time atas kondisi keuangan koperasi
- **Risiko kepatuhan** — laporan RAT dan laporan keuangan sulit dibuat secara akurat
- **Keterbatasan skalabilitas** — tidak ada sistem kolaborasi multi-user dengan role berbeda
- **Kurangnya early warning** — tidak ada sistem untuk mendeteksi anggota yang mulai menunggak cicilan

---

## 3. Goals & Objectives

### Primary Goals
- Menyediakan sistem manajemen koperasi yang lengkap, mudah digunakan, dan terjangkau
- Mendukung operasional KSP konvensional dan syariah dalam satu platform
- Memungkinkan akses multi-user dengan kontrol akses berbasis peran (RBAC)

### Success Metrics
| Metrik | Target (6 bulan) |
|--------|-----------------|
| Jumlah koperasi terdaftar | 50 koperasi |
| Rata-rata anggota per koperasi | 200 anggota |
| Uptime platform | ≥ 99.5% |
| Waktu onboarding koperasi baru | < 30 menit |
| NPS score dari admin koperasi | ≥ 7/10 |

---

## 4. Target Users

### 4.1 Platform Owner (Super Admin SaaS)
- Mengelola seluruh koperasi yang terdaftar di platform
- Mengatur paket langganan dan modul yang tersedia
- Memantau tanggal tagihan berikutnya (next billing date) tiap koperasi dan status pembayarannya
- Memantau kesehatan platform secara keseluruhan
- Akses via: `admin.siskop.com`

### 4.2 Admin Koperasi (Superadmin Tenant)
- Kepala koperasi atau manajer yang mendaftarkan koperasi ke sistem
- Mengelola user, roles, dan konfigurasi sistem koperasi
- Akses penuh ke semua modul dalam koperasinya

### 4.3 Pegawai/Teller Koperasi
- Staff yang membantu anggota melakukan transaksi simpan-pinjam
- Melakukan input data transaksi harian
- Akses terbatas sesuai role yang ditetapkan admin

### 4.4 Manajer Koperasi
- Memantau dashboard, laporan, dan kondisi pinjaman
- Akses baca penuh + persetujuan transaksi tertentu
- Tidak bisa mengelola user atau konfigurasi sistem

### 4.5 Viewer (Read-Only)
- Role default keempat yang disediakan sistem untuk kebutuhan audit/pengawasan internal
- Akses baca ke dashboard, anggota, simpanan, pinjaman, dan laporan
- Tidak bisa membuat/mengubah transaksi maupun mengelola user, role, atau konfigurasi

> Keempat role di atas (Super Admin, Manajer, Teller, Viewer) adalah role bawaan yang dibuat otomatis saat koperasi mendaftar. Admin koperasi tetap bebas membuat role kustom lain melalui permission matrix (lihat CFG-04).

---

## 5. User Stories

### 5.1 Registrasi Koperasi
```
SEBAGAI kepala koperasi
SAYA INGIN mendaftarkan koperasi saya ke platform SISKOP
AGAR koperasi saya mendapatkan sistem manajemen digital terintegrasi
DENGAN KETENTUAN:
  - Saya mengisi nama, alamat, nomor pendaftaran, jenis (syariah/konvensional)
  - Sistem membuat subdomain otomatis: {namakoperasi}.siskop.com
  - Saya menjadi superadmin dari koperasi yang didaftarkan
```

### 5.2 Login Multi-Tenant
```
SEBAGAI pengguna sistem koperasi
SAYA INGIN login melalui subdomain koperasi saya
AGAR saya hanya bisa mengakses data koperasi saya sendiri
DENGAN KETENTUAN:
  - Login via email + password ATAU Google SSO
  - Jika email tidak terdaftar, sistem menampilkan pesan error yang jelas
  - Setelah login, diarahkan ke dashboard sesuai role
```

### 5.3 Pendaftaran Anggota
```
SEBAGAI pegawai koperasi
SAYA INGIN mendaftarkan anggota baru ke sistem
AGAR anggota dapat menggunakan layanan simpan pinjam koperasi
DENGAN KETENTUAN:
  - Input: nama lengkap, NIK, alamat, tempat/tanggal lahir, pekerjaan, foto KTP
  - Sistem auto-generate ID Anggota dan Nomor Rekening
  - Data tersimpan dan bisa dicari kembali
```

### 5.4 Transaksi Simpanan
```
SEBAGAI teller koperasi
SAYA INGIN mencatat setoran simpanan anggota
AGAR saldo simpanan anggota terupdate secara real-time
DENGAN KETENTUAN:
  - Pilih anggota berdasarkan ID atau nama
  - Pilih jenis simpanan (pokok/wajib/sukarela)
  - Input nominal, sistem catat waktu transaksi
  - Saldo anggota langsung terupdate
```

### 5.5 Pengajuan Pinjaman
```
SEBAGAI pegawai koperasi
SAYA INGIN memproses pengajuan pinjaman anggota
AGAR anggota mendapatkan dana pinjaman yang dibutuhkan
DENGAN KETENTUAN:
  - Hanya anggota dengan simpanan pokok yang berhak mengajukan
  - Sistem check otomatis apakah anggota sudah memiliki pinjaman aktif
  - Input: jenis pembiayaan, nominal, tenor
  - Sistem hitung angsuran otomatis (konvensional: anuitas; syariah: flat)
```

### 5.6 Pembayaran Cicilan
```
SEBAGAI teller koperasi
SAYA INGIN mencatat pembayaran cicilan anggota
AGAR sisa hutang anggota terupdate dan KOL ter-recalculate
DENGAN KETENTUAN:
  - Pilih pinjaman aktif anggota
  - Input nominal bayar
  - Sistem update sisa cicilan dan recalculate KOL category
  - Anggota yang terlambat muncul di halaman monitoring
```

### 5.7 Laporan Keuangan
```
SEBAGAI manajer koperasi
SAYA INGIN mencetak laporan keuangan bulanan/tahunan
AGAR saya bisa melaporkan kondisi keuangan ke anggota pada RAT
DENGAN KETENTUAN:
  - Filter berdasarkan range tanggal, bulanan, atau tahunan
  - Tersedia laporan keuangan dan laporan RAT
  - Export ke PDF dengan header (logo, nama, alamat koperasi)
  - Footer berisi nama koperasi dan nomor halaman
```

### 5.8 Monitoring KOL (Platform Owner)
```
SEBAGAI platform owner
SAYA INGIN memantau semua koperasi yang terdaftar
AGAR saya bisa memastikan platform berjalan dengan baik
DENGAN KETENTUAN:
  - Dashboard jumlah koperasi aktif, total transaksi, total anggota
  - Bisa aktivasi/deaktivasi koperasi
  - Kelola paket langganan dan modul yang tersedia
```

### 5.9 Reminder Tagihan Langganan & Blokir Akses Otomatis
```
SEBAGAI platform owner
SAYA INGIN sistem mengingatkan koperasi sebelum tagihan langganan jatuh tempo
AGAR koperasi punya waktu memperpanjang sebelum aksesnya terganggu
DENGAN KETENTUAN:
  - Setiap koperasi memiliki tanggal Tagihan Berikutnya (Next Billing Date) yang bisa
    diatur/diubah oleh platform admin
  - Sistem mengirim email pengingat otomatis ke admin koperasi 30 hari dan 7 hari
    sebelum tanggal jatuh tempo
  - Jika tagihan belum diperbarui hingga melewati tanggal jatuh tempo, akses seluruh
    user koperasi tersebut (login) otomatis diblokir
  - Platform admin bisa memperbarui tanggal tagihan kapan saja; pembaruan ke tanggal
    yang akan datang otomatis mereset siklus pengingat dan membuka blokir akses
```

### 5.10 Paket Langganan Bergranular Modul (Entitlement)
```
SEBAGAI platform owner
SAYA INGIN paket langganan mengontrol bukan hanya modul apa yang terlihat,
tapi juga batas dan sub-fitur di dalam modul tersebut
AGAR saya bisa membedakan penawaran antar tier paket secara lebih detail
DENGAN KETENTUAN:
  - Setiap koperasi otomatis mendapat 3 jenis simpanan default (Pokok/Wajib/Sukarela)
    saat registrasi, terlepas dari paket yang dipilih
  - Paket dapat menetapkan batas jumlah konfigurasi simpanan custom tambahan
    (kosong = tak terbatas); batas ini ditegakkan di backend, bukan hanya UI
  - Paket dapat mengaktifkan/menonaktifkan fitur whitelabel (branding, domain
    kustom, identitas pengirim email) untuk koperasi pada paket tersebut
  - Jika paket koperasi diturunkan (downgrade) hingga di bawah kuota yang sedang
    dipakai, data yang melebihi kuota TIDAK dihapus — dibekukan (read-only) dan
    otomatis aktif kembali jika koperasi naik paket lagi
```

### 5.11 Notifikasi Platform (Host)

```
SEBAGAI platform owner
SAYA INGIN menerima notifikasi in-app saat terjadi event penting di platform
AGAR saya tidak perlu memantau setiap koperasi secara manual
DENGAN KETENTUAN:
  - Event yang memicu notifikasi: koperasi baru mendaftar, koperasi diblokir
    otomatis karena tagihan lewat jatuh tempo, paket langganan koperasi diubah
  - Notifikasi ditampilkan sebagai bell icon dengan badge jumlah belum dibaca
    di topbar admin.siskop.com
  - Status baca/belum dibaca bersifat per platform admin (bukan global) —
    satu admin menandai baca tidak memengaruhi admin lain
```

### 5.12 Konfigurasi Akun (Chart of Accounts)
```
SEBAGAI admin koperasi
SAYA INGIN mendefinisikan bagan akun (Chart of Accounts) dan memetakan jenis
transaksi simpanan/pinjaman ke akun yang sesuai
AGAR koperasi punya dasar akuntansi yang memenuhi SAK EP (berlaku sejak
Permenkop UKM No. 2/2024, menggantikan PSAK 27) tanpa harus menunggu modul
jurnal/neraca penuh
DENGAN KETENTUAN:
  - Modul ini digated oleh entitlement paket langganan (modul "accounting"),
    sama seperti pola gating whitelabel (lihat 5.10)
  - Akun bersifat hierarkis (header/group vs. detail yang bisa dipakai transaksi)
    dan kode akun mengikuti konvensi prefiks kategori (1- Aset, 2- Kewajiban,
    3- Ekuitas, 4- Pendapatan, 5- Beban), divalidasi di backend
  - Tersedia template COA standar (20 akun) yang bisa diisi otomatis dengan
    satu klik pada koperasi yang belum punya akun sama sekali
  - Klasifikasi Simpanan Pokok/Wajib sebagai Ekuitas dan Simpanan Sukarela
    sebagai Kewajiban adalah default template yang DAPAT diubah tenant —
    bukan logika hardcoded di aplikasi
  - Pemetaan transaksi ke akun bersifat opsional — SAV-01/LOAN-01 tetap
    berfungsi normal jika akuntansi belum dikonfigurasi; kelengkapan pemetaan
    ditampilkan sebagai indikator UI ("X dari Y jenis transaksi sudah
    dipetakan"), bukan hard gate
  - Akun bawaan (isDefault) dan akun yang masih dipakai pemetaan tidak bisa
    dihapus/dinonaktifkan
  - TIDAK termasuk: mesin jurnal/posting otomatis dan laporan keuangan
    ter-generate dari ledger (Neraca, Laporan Hasil Usaha/SHU, Arus Kas,
    Promosi Ekonomi Anggota) — fase berikutnya, lihat
    `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md` §10
```

---

## 6. Functional Requirements

### 6.1 Modul Autentikasi & Multi-Tenancy
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| AUTH-01 | Login menggunakan email + password | Must Have |
| AUTH-02 | Login menggunakan Google SSO | Should Have — **belum diimplementasikan**: endpoint `/api/auth/google` & `/google/callback` masih placeholder (`501 NOT_IMPLEMENTED`), library OAuth belum terpasang |
| AUTH-03 | Subdomain-based tenant isolation | Must Have |
| AUTH-04 | JWT access token (15 menit) + refresh token (7 hari), disimpan sebagai httpOnly cookie | Must Have |
| AUTH-05 | Auto-redirect ke login jika token expired (refresh otomatis via interceptor, retry sekali) | Must Have |
| AUTH-06 | Error message yang jelas jika email tidak terdaftar / koperasi tidak ditemukan (`TENANT_NOT_FOUND`) | Must Have |
| AUTH-07 | Registrasi koperasi baru (public endpoint) | Must Have |
| AUTH-08 | Auto-generate subdomain dari nama koperasi | Must Have |
| AUTH-09 | Akun dengan `passwordHash` kosong hanya bisa login via Google SSO (`SSO_ONLY_ACCOUNT`) | Must Have |

### 6.2 Modul Dashboard
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| DASH-01 | Card total simpanan (nominal Rupiah) | Must Have |
| DASH-02 | Card total pinjaman aktif | Must Have |
| DASH-03 | Card jumlah anggota aktif | Must Have |
| DASH-04 | Card angsuran bulan ini | Must Have |
| DASH-05 | Card anggota dengan status MACET (alert) | Must Have |
| DASH-06 | Grafik pinjaman per bulan (bar chart, 12 bulan) | Must Have |
| DASH-07 | Grafik pembayaran cicilan per bulan (line chart) | Must Have |
| DASH-08 | Setiap card clickable, navigasi ke halaman detail | Must Have |

### 6.3 Modul Anggota
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| MBR-01 | Form pendaftaran anggota dengan validasi | Must Have |
| MBR-02 | Upload foto KTP | Must Have |
| MBR-03 | Auto-generate ID Anggota (KOP-{SLUG}-{YYYYMM}-{SEQ}) | Must Have |
| MBR-04 | Auto-generate Nomor Rekening (ACC-{10 digit}) | Must Have |
| MBR-05 | Pencarian anggota by nama/NIK/ID | Must Have |
| MBR-06 | Edit data anggota | Must Have |
| MBR-07 | Soft delete anggota (nonaktifkan) | Must Have |
| MBR-08 | Detail anggota + riwayat transaksi | Must Have |

### 6.4 Modul Simpanan
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| SAV-01 | Konfigurasi jenis simpanan (pokok/wajib/sukarela) | Must Have |
| SAV-02 | Setup rate bunga/bagi hasil per jenis simpanan | Must Have |
| SAV-03 | Input setoran simpanan oleh teller | Must Have |
| SAV-04 | Input penarikan simpanan | Must Have |
| SAV-05 | Riwayat transaksi simpanan per anggota | Must Have |
| SAV-06 | Saldo simpanan real-time | Must Have |
| SAV-07 | Mendukung simpanan konvensional dan syariah | Must Have |
| SAV-08 | Auto-seed 3 jenis simpanan default (Pokok/Wajib/Sukarela, `isDefault=true`) saat registrasi koperasi, terlepas dari paket langganan | Must Have |
| SAV-09 | Batas jumlah konfigurasi simpanan custom (`isDefault=false`) sesuai `maxSavingConfigs` pada paket tenant; indikator kuota ditampilkan di layar Konfigurasi Simpanan, tombol "Tambah" nonaktif saat kuota tercapai | Must Have |

### 6.5 Modul Pinjaman/Pembiayaan
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| LOAN-01 | Konfigurasi jenis pembiayaan + bunga/margin | Must Have |
| LOAN-02 | Validasi kelayakan (harus punya simpanan pokok) | Must Have |
| LOAN-03 | Check pinjaman aktif sebelum pengajuan baru | Must Have |
| LOAN-04 | Kalkulasi angsuran otomatis (konvensional & syariah) | Must Have |
| LOAN-05 | Input pembayaran cicilan | Must Have |
| LOAN-06 | Update sisa cicilan setelah pembayaran | Must Have |
| LOAN-07 | Kategorisasi KOL otomatis (recalculate setelah tiap pembayaran + cron harian 00:05 WIB) | Must Have |
| LOAN-08 | Halaman monitoring anggota menunggak (`/loans/overdue`, urut MACET → LANCAR) | Must Have |
| LOAN-09 | Dashboard khusus pinjaman/pembiayaan | Must Have |
| LOAN-10 | Konfigurasi threshold KOL per tenant di system config | Must Have |
| LOAN-11 | Filter daftar pinjaman berdasarkan jenis pembiayaan (`loanConfigId`) di halaman dashboard pinjaman | Must Have |

**Default kategori KOL (mengikuti ketentuan OJK, dapat dikustomisasi per tenant):**

| Kategori | Hari Menunggak | Aksi Sistem |
|---|---|---|
| LANCAR | 0–30 hari | Tidak ada |
| DALAM_PERHATIAN | 31–90 hari | Tandai untuk monitoring, email ke manajer |
| KURANG_LANCAR | 91–120 hari | Batasi pengajuan pinjaman baru |
| DIRAGUKAN | 121–180 hari | Eskalasi ke manajer, email ke kontak anggota |
| MACET | > 180 hari | Alert dashboard, batasi seluruh transaksi |

Jika tenant belum mengatur threshold kustom, sistem menggunakan default OJK di atas.

### 6.6 Modul Laporan
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| RPT-01 | Laporan keuangan (pemasukan, simpanan, pinjaman) | Must Have |
| RPT-02 | Laporan RAT (Rapat Anggota Tahunan) | Must Have |
| RPT-03 | Filter: range tanggal, bulanan, tahunan | Must Have |
| RPT-04 | Export PDF dengan header & footer koperasi | Must Have |
| RPT-05 | Header PDF: logo, nama, alamat, no. pendaftaran | Must Have |
| RPT-06 | Footer PDF: nama koperasi + nomor halaman | Must Have |
| RPT-07 | Mendukung laporan konvensional dan syariah | Must Have |

### 6.7 Modul Sistem Konfigurasi
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| CFG-01 | Update profil user (nama, password, username) | Must Have |
| CFG-02 | Upload logo koperasi (superadmin only) | Must Have |
| CFG-03 | User management (CRUD user) | Must Have |
| CFG-04 | Role management dengan permission matrix per modul | Must Have |
| CFG-05 | CRUD permission per modul per role | Must Have |
| CFG-06 | Konfigurasi jenis simpanan + rate | Must Have |
| CFG-07 | Konfigurasi jenis pembiayaan + bunga/margin | Must Have |
| CFG-08 | Konfigurasi KOL category dan threshold | Must Have |
| CFG-09 | Hapus role kustom | Must Have |
| CFG-10 | Whitelabel: branding (warna utama, sembunyikan "Powered by SISKOP"), domain kustom, identitas pengirim email — hanya tampil/dapat diubah jika paket tenant `whitelabelEnabled`; nilai tersimpan tetap terlihat (read-only) saat fitur dibekukan akibat downgrade paket | Should Have — **domain kustom belum lengkap**: field & status badge (`PENDING`/`VERIFIED`/`FAILED`) sudah ada, tapi verifikasi DNS/CNAME otomatis dan provisioning sertifikat SSL per-domain belum diimplementasikan (lihat `Docs/specs/2026-07-21-paket-langganan-design.md` §9) — status akan selalu `PENDING`. Branding dan identitas pengirim email sudah fungsional penuh. |
| CFG-11 | Konfigurasi Akun: CRUD bagan akun (Chart of Accounts) hierarkis dengan kode ter-prefiks kategori (Aset/Kewajiban/Ekuitas/Pendapatan/Beban); hanya tampil/dapat diakses jika paket tenant menyertakan modul `"accounting"` | Must Have — lihat `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md` |
| CFG-12 | Isi otomatis template COA standar (20 akun) dengan satu klik pada koperasi yang belum punya akun | Must Have |
| CFG-13 | Pemetaan jenis transaksi simpanan/pinjaman (Setoran, Penarikan, Pencairan, Pembayaran Pokok, Pembayaran Bunga/Margin, Denda) ke akun debit/kredit, dengan validasi arah saldo normal per jenis transaksi | Must Have |
| CFG-14 | Indikator kelengkapan pemetaan transaksi ("X dari Y jenis transaksi sudah dipetakan") — informasional, tidak memblokir transaksi simpanan/pinjaman yang sudah ada | Must Have |
| CFG-15 | Proteksi akun bawaan (`isDefault=true`) dan akun yang masih dipakai pemetaan dari penghapusan/penonaktifan (`409 ACCOUNT_IN_USE`) | Must Have |

### 6.8 Modul Platform Admin
| ID | Requirement | Prioritas |
|----|-------------|-----------|
| ADM-01 | Dashboard platform (total & tenant aktif, total anggota aktif, transaksi 30 hari terakhir) | Must Have |
| ADM-02 | Daftar semua koperasi terdaftar (paginated) + detail & statistik per koperasi (jumlah anggota, simpanan, pinjaman, pinjaman aktif) | Must Have |
| ADM-03 | Aktivasi/deaktivasi koperasi | Must Have |
| ADM-04 | Manajemen paket langganan (nama, harga, batas maksimum user, batas maksimum anggota, batas simpanan custom, toggle whitelabel) | Must Have |
| ADM-05 | Konfigurasi daftar modul yang tersedia per paket | Must Have |
| ADM-06 | URL khusus: `admin.siskop.com` | Must Have |
| ADM-07 | Atur & tampilkan tanggal Tagihan Berikutnya per koperasi | Must Have |
| ADM-08 | Email pengingat otomatis 30 hari & 7 hari sebelum jatuh tempo tagihan | Must Have |
| ADM-09 | Blokir akses koperasi otomatis saat tagihan melewati jatuh tempo; pembaruan tanggal tagihan otomatis membuka blokir | Must Have |
| ADM-10 | Manajemen user platform admin (list, tambah, nonaktifkan, aktifkan kembali); platform admin tidak bisa menonaktifkan akunnya sendiri | Must Have |
| ADM-11 | Host dapat mengunggah/mengganti logo koperasi dari halaman detail tenant | Must Have |
| ADM-12 | Notifikasi in-app (bell) untuk event platform-wide: koperasi baru terdaftar, koperasi diblokir karena tagihan, perubahan paket langganan; status baca per platform admin | Must Have |

---

## 7. Non-Functional Requirements

### 7.1 Performance
- Halaman dashboard load < 3 detik pada koneksi 10 Mbps
- API response time < 500ms untuk operasi standar
- PDF generation < 10 detik

### 7.2 Security
- Isolasi data anggota antar tenant (row-level tenantId)
- Password di-hash menggunakan bcrypt (cost factor ≥ 12)
- Rate limiting pada endpoint login (max 10 percobaan/menit)
- HTTPS wajib untuk semua komunikasi
- Token stored sebagai httpOnly cookie (bukan localStorage)

### 7.3 Availability
- Uptime target: 99.5% (downtime max ~3.6 jam/bulan)
- Backup database harian

### 7.4 Usability
- Responsive design — mendukung desktop, tablet, dan mobile
- Bahasa antarmuka: Bahasa Indonesia
- Format mata uang: Rupiah (Rp X.XXX.XXX)
- Format tanggal: DD MMMM YYYY (contoh: 15 Juni 2026)

### 7.5 Scalability
- Arsitektur multi-tenant mendukung hingga 1.000 koperasi
- Setiap koperasi mendukung hingga 10.000 anggota

---

## 8. Out of Scope (v1.0)

- Mobile app (iOS/Android) — direncanakan v2.0
- Integrasi payment gateway untuk pembayaran online
- Notifikasi SMS/WhatsApp otomatis
- Fitur akuntansi lengkap: mesin jurnal/posting otomatis dan laporan keuangan ter-generate dari ledger (Neraca, Laporan Perhitungan Hasil Usaha/SHU, Laporan Arus Kas, Laporan Promosi Ekonomi Anggota, Catatan Atas Laporan Keuangan) — **catatan**: konfigurasi bagan akun (Chart of Accounts) dan pemetaan transaksi ke akun (tanpa posting) SUDAH masuk scope v1.1 sebagai modul `"accounting"` berbayar terpisah (§5.12, §6.7 CFG-11–15); RPT-01/RPT-02 tetap berjalan seperti sebelumnya dan tidak tergantung pada modul ini — lihat `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md`
- API publik untuk integrasi pihak ketiga
- Multi-bahasa (selain Bahasa Indonesia)

---

## 9. Assumptions & Constraints

- Koperasi diasumsikan memiliki koneksi internet minimal 5 Mbps
- User diasumsikan familiar dengan penggunaan browser web
- Regulasi: sistem mengikuti ketentuan umum KSP di Indonesia (UU No. 25/1992 tentang Perkoperasian)
- Permenkop UKM No. 2/2024 mewajibkan koperasi menyusun laporan keuangan mengikuti SAK EP (Standar Akuntansi Keuangan Entitas Privat, berlaku untuk periode mulai 1 Jan 2025), menggantikan PSAK 27 yang telah dicabut — mendasari modul Konfigurasi Akun (§5.12); template COA bawaan (§5.12) adalah titik awal yang wajar, bukan template tersertifikasi/teraudit — tenant (atau akuntan mereka) tetap bertanggung jawab menyesuaikannya dengan kewajiban pelaporan spesifik mereka
- Untuk koperasi syariah, perhitungan menggunakan akad Murabahah (margin flat)
