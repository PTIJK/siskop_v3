# Functional Specification Document (FSD)
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Versi** | 1.2.0 |
| **Tanggal** | 22 Juli 2026 |
| **Status** | Draft — disinkronkan dengan implementasi berjalan |

---

## 1. System Overview

SISKOP adalah platform multi-tenant SaaS dengan arsitektur subdomain-based tenancy. Setiap koperasi yang terdaftar mendapatkan subdomain eksklusif (`{slug}.siskop.com`) dan data yang sepenuhnya terisolasi dari koperasi lain.

### 1.1 Entry Points

| URL | Deskripsi |
|-----|-----------|
| `siskop.com` | Landing page + registrasi koperasi baru |
| `{slug}.siskop.com` | Sistem koperasi (login + semua modul) |
| `admin.siskop.com` | Platform admin (pemilik sistem) |

### 1.2 User Flow Utama

```
[User] → siskop.com/login
       → Input subdomain koperasi
       → Redirect ke {slug}.siskop.com/login
       → Input email + password (atau Google SSO)
       → Verifikasi tenant + user
       → Dashboard (sesuai role)
```

---

## 2. Modul Autentikasi

### 2.1 Registrasi Koperasi Baru

**Endpoint:** `POST /api/auth/register-tenant`

**Input Form:**
| Field | Tipe | Validasi |
|-------|------|----------|
| Nama Koperasi | String | Required, min 3 char |
| Alamat | String | Required |
| No. Pendaftaran Koperasi | String | Required, unique |
| Jenis Koperasi | Enum | SYARIAH / KONVENSIONAL |
| Tipe Koperasi | String | Default: "Koperasi Simpan Pinjam" |
| Nama Admin | String | Required |
| Email Admin | Email | Required, valid email |
| Password Admin | String | Min 8 char, 1 uppercase, 1 angka |

**Proses Sistem:**
1. Validasi semua field
2. Cek duplikasi `no_pendaftaran` dan `slug`
3. Generate slug dari nama koperasi (lowercase, hapus spasi/karakter khusus)
   - Contoh: "Koperasi Sejahtera Mandiri" → `koperasisejahteramandiri`
4. Buat record `Tenant` di database
5. Buat record `User` dengan role SUPER_ADMIN
6. Seed default roles (SUPER_ADMIN, MANAGER, TELLER, VIEWER)
7. Return: `{ tenantSlug, loginUrl: "https://{slug}.siskop.com/login" }`

### 2.2 Login

**Endpoint:** `POST /api/auth/login`

**Input:**
```json
{ "email": "user@koperasi.com", "password": "Password123!" }
```

**Proses:**
1. Extract tenant dari subdomain (`req.hostname`)
2. Cari `Tenant` by slug — return 404 jika tidak ditemukan
3. Cari `User` by `email + tenantId`
4. Verifikasi password dengan bcrypt
5. Generate access token (JWT, 15 menit) + refresh token (JWT, 7 hari)
6. Set keduanya sebagai httpOnly cookie
7. Return: `{ user: { id, name, email, role }, tenant: { id, name, type } }`

**Error Cases:**
| Kondisi | HTTP Status | Pesan |
|---------|-------------|-------|
| Tenant tidak ditemukan | 404 | "Koperasi tidak ditemukan" |
| Email tidak terdaftar | 401 | "Email atau password salah" |
| Password salah | 401 | "Email atau password salah" |
| User dinonaktifkan | 403 | "Akun Anda telah dinonaktifkan" |

### 2.3 Google SSO

**Flow:**
1. User klik "Login dengan Google"
2. Redirect ke `GET /api/auth/google` → Google OAuth consent
3. Google redirect ke `GET /api/auth/google/callback`
4. Sistem cek apakah email dari Google terdaftar di tenant
5. Jika terdaftar → login normal, set cookies, redirect ke dashboard
6. Jika tidak terdaftar → redirect ke `/login?error=email_not_registered`

### 2.4 Token Refresh

**Endpoint:** `POST /api/auth/refresh`

Sistem membaca refresh token dari httpOnly cookie, verifikasi, dan generate access token baru.

---

## 3. Modul Dashboard

### 3.1 Komponen Dashboard

Setiap card mengambil data dari endpoint terpisah dan dapat di-klik untuk navigasi.

| Card | Endpoint | Navigasi Tujuan |
|------|----------|-----------------|
| Total Simpanan | `GET /api/dashboard/total-savings` | `/savings` |
| Total Pinjaman Aktif | `GET /api/dashboard/total-loans` | `/loans` |
| Jumlah Anggota | `GET /api/dashboard/member-count` | `/members` |
| Angsuran Bulan Ini | `GET /api/dashboard/monthly-payments` | `/loans` |
| Anggota MACET | `GET /api/dashboard/overdue-alert` | `/loans/overdue` |

**Endpoint Grafik:**
- `GET /api/dashboard/loan-chart?months=12` → data disbursement per bulan
- `GET /api/dashboard/payment-chart?months=12` → data pembayaran cicilan per bulan

**Response Format (semua dashboard endpoint):**
```json
{
  "success": true,
  "data": {
    "value": "1500000000",
    "label": "Total Simpanan",
    "currency": true,
    "trend": "+12%",
    "trendDirection": "up"
  }
}
```

---

## 4. Modul Anggota

### 4.1 Pendaftaran Anggota

**Endpoint:** `POST /api/members`

**Input:**
| Field | Tipe | Validasi |
|-------|------|----------|
| Nama Lengkap | String | Required |
| NIK | String | Required, 16 digit, unique per tenant |
| Alamat | String | Required |
| Tempat Lahir | String | Required |
| Tanggal Lahir | Date | Required, format YYYY-MM-DD |
| Pekerjaan | String | Required |
| Foto KTP | File | Optional, jpg/png/pdf, max 2MB |

**Auto-Generate:**
```
memberId:      KOP-{TENANTSLUG}-{YYYYMM}-{4-digit-sequence}
               Contoh: KOP-KOPSEJAHTERA-202606-0001

accountNumber: ACC-{10-digit-random-numeric}
               Contoh: ACC-3847291045
```

**Sequence Rules:**
- Sequence di-reset setiap bulan
- Sequence per tenant (bukan global)
- Padding 4 digit dengan leading zeros

### 4.2 Pencarian Anggota

**Endpoint:** `GET /api/members?search=&page=1&limit=20&sortBy=createdAt&sortOrder=desc`

Search mencakup: nama lengkap, NIK, memberId, accountNumber

**Response:**
```json
{
  "success": true,
  "data": [{ "id", "memberId", "accountNumber", "fullName", "nik", "isActive" }],
  "meta": { "page": 1, "limit": 20, "total": 150 }
}
```

### 4.3 Detail Anggota

**Endpoint:** `GET /api/members/:id`

Response mencakup: data anggota + ringkasan simpanan + ringkasan pinjaman aktif.

---

## 5. Modul Simpanan

### 5.1 Konfigurasi Jenis Simpanan

**Endpoint:** `POST /api/savings/configs`

| Field | Tipe | Keterangan |
|-------|------|------------|
| Nama | String | Contoh: "Simpanan Pokok", "Simpanan Wajib" |
| Tipe | Enum | POKOK / WAJIB / SUKARELA |
| Jenis Rate | Enum | BUNGA (konvensional) / BAGI_HASIL (syariah) |
| Rate | Decimal | Persentase per periode |
| Periode | Enum | MONTHLY / YEARLY |

Koperasi syariah menggunakan BAGI_HASIL; koperasi konvensional menggunakan BUNGA.

### 5.2 Input Setoran

**Endpoint:** `POST /api/savings/:savingId/deposit`

```json
{
  "amount": "500000",
  "note": "Setoran simpanan wajib bulan Juni"
}
```

Sistem akan:
1. Validasi saving account milik anggota dalam tenant yang sama
2. Tambah `amount` ke `Saving.balance`
3. Buat record `SavingTransaction` dengan type `DEPOSIT`
4. Return saldo terbaru

### 5.3 Penarikan Simpanan

**Endpoint:** `POST /api/savings/:savingId/withdraw`

Validasi tambahan:
- Saldo tidak boleh kurang dari nol setelah penarikan
- Simpanan POKOK tidak dapat ditarik selama anggota masih punya pinjaman aktif

---

## 6. Modul Pinjaman/Pembiayaan

### 6.0 Daftar Pinjaman & Filter

**Endpoint:** `GET /api/loans?page=1&limit=20&status=&loanConfigId=&search=`

`loanConfigId` (optional) menyaring daftar pinjaman berdasarkan jenis pembiayaan yang dipilih pada dropdown filter di halaman dashboard pinjaman. Jika kosong, semua jenis pembiayaan ditampilkan.

### 6.1 Konfigurasi Jenis Pembiayaan

**Endpoint:** `POST /api/loans/configs`

| Field | Tipe | Keterangan |
|-------|------|------------|
| Nama | String | Contoh: "KUR Mikro", "Pembiayaan Murabahah" |
| Tipe | Enum | SYARIAH / KONVENSIONAL |
| Jenis Rate | Enum | BUNGA / MARGIN / BAGI_HASIL |
| Rate | Decimal | Persentase per tahun |
| Tenor Maksimal | Integer | Dalam bulan |

### 6.2 Pengajuan Pinjaman Baru

**Endpoint:** `POST /api/loans`

**Validasi Pre-Approval:**
```
Step 1: Cek anggota memiliki simpanan POKOK dengan balance > 0
        → Error jika tidak: "Anggota belum memiliki simpanan pokok"

Step 2: Cek pinjaman aktif
        → Jika ada: return { hasExistingLoan: true, existingLoan: {...} }
        → Frontend tampilkan dialog konfirmasi
        → Jika user konfirmasi lanjut: kirim ulang dengan flag force: true
```

**Kalkulasi Angsuran:**

Konvensional (anuitas):
```
monthlyRate     = annualRate / 12 / 100
monthlyPayment  = principal × monthlyRate / (1 - (1 + monthlyRate)^(-termMonths))
totalAmount     = monthlyPayment × termMonths
```

Syariah (murabahah flat):
```
margin          = principal × (marginRate / 100) × (termMonths / 12)
totalAmount     = principal + margin
monthlyPayment  = totalAmount / termMonths
```

**Input:**
```json
{
  "memberId": "...",
  "loanConfigId": "...",
  "principalAmount": "10000000",
  "termMonths": 12,
  "force": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "principalAmount": "10000000",
    "totalAmount": "11200000",
    "monthlyPayment": "933333.33",
    "termMonths": 12,
    "status": "ACTIVE"
  }
}
```

### 6.3 Pembayaran Cicilan

**Endpoint:** `POST /api/loans/:loanId/pay`

```json
{
  "amount": "933333.33",
  "paidAt": "2026-06-15",
  "note": "Pembayaran cicilan bulan ke-3"
}
```

**Proses Sistem:**
1. Validasi loan aktif dan milik tenant
2. Buat record `LoanPayment`
3. Update `Loan.remainingAmount` (kurangi dengan amount bayar)
4. Jika `remainingAmount <= 0` → ubah `Loan.status` menjadi `COMPLETED`
5. Panggil `recalculateKOL(loanId)` untuk update kategori
6. Return: saldo sisa + KOL category terbaru

### 6.4 KOL (Kualitas Obligasi/Loan) Kategorisasi

**Trigger:** Setiap pembayaran + cron job harian (00:05 WIB)

**Logika Kalkulasi:**
```
daysOverdue = hari ini - tanggal jatuh tempo cicilan tertua yang belum dibayar

LANCAR              : 0–30 hari
DALAM_PERHATIAN     : 31–90 hari
KURANG_LANCAR       : 91–120 hari
DIRAGUKAN           : 121–180 hari
MACET               : > 180 hari
```

**Tampilan Dashboard:**
- MACET dan DIRAGUKAN muncul di alert section halaman utama pinjaman
- Halaman `/loans/overdue` menampilkan semua anggota non-LANCAR, diurutkan dari yang paling parah

**Warna Badge:**
| KOL | Warna |
|-----|-------|
| LANCAR | Hijau |
| DALAM_PERHATIAN | Kuning |
| KURANG_LANCAR | Oranye |
| DIRAGUKAN | Merah |
| MACET | Merah Tua |

---

## 7. Modul Laporan

### 7.1 Laporan Keuangan

**Endpoint:** `GET /api/reports/financial?startDate=&endDate=&period=monthly`

**Komponen Laporan:**
- Ringkasan posisi keuangan (total aset, simpanan, pinjaman)
- Rincian transaksi simpanan (setoran & penarikan)
- Rincian pinjaman yang dicairkan
- Rincian pembayaran cicilan diterima
- Laporan pendapatan bunga/margin

### 7.2 Laporan RAT

**Endpoint:** `GET /api/reports/rat?year=2026`

**Komponen Laporan:**
- Perkembangan jumlah anggota (awal tahun vs akhir tahun)
- Total simpanan per jenis
- Total pinjaman per jenis + status
- Pendapatan bersih koperasi
- Distribusi SHU (Sisa Hasil Usaha) — jika konfigurasi tersedia

### 7.3 Export PDF

**Endpoint:** `GET /api/reports/financial/pdf?startDate=&endDate=`

**Struktur PDF:**

```
┌─────────────────────────────────────────────────┐
│  [LOGO]   KOPERASI SEJAHTERA MANDIRI            │
│           Jl. Merdeka No. 10, Jakarta           │
│           No. Reg: 123/KOP/2020                 │
├─────────────────────────────────────────────────┤
│         LAPORAN KEUANGAN                        │
│         Periode: Januari - Juni 2026            │
├─────────────────────────────────────────────────┤
│  [Tabel Laporan]                                │
│  ...                                            │
├─────────────────────────────────────────────────┤
│  Koperasi Sejahtera Mandiri        Halaman 1/3  │
└─────────────────────────────────────────────────┘
```

Implementasi: Puppeteer render HTML template → export PDF stream.

### 7.4 Laporan Keuangan Regulasi (Permenkop UKM No. 2/2024)

Digated oleh entitlement paket (`"accounting"` di `SubscriptionPackage.modules[]`, sama seperti Konfigurasi Akun §8.3), di bawah permission key `reports` yang sudah ada. Lihat `Docs/specs/2026-07-22-pelaporan-regulasi-design.md`.

**Mesin jurnal (posting engine):** setiap `SavingTransaction`, `LoanPayment`, dan pencairan `Loan` otomatis menghasilkan satu `JournalEntry` + baris `JournalLine` double-entry, memakai `AccountMapping` yang dikonfigurasi tenant (§8.4) untuk menentukan akun debit/kredit. Forward-only — tidak ada CRUD manual jurnal di v1. Jika mapping untuk suatu `transactionKind` belum dikonfigurasi, `JournalEntry` tetap dibuat dengan `status = UNPOSTED_MISSING_MAPPING` (bukan gagal total) dan tidak ikut dihitung laporan sampai mapping dilengkapi.

**Neraca** — `GET /api/reports/regulatory/neraca?asOfDate=`
- Posisi keuangan per tanggal cutoff (default: hari ini), diagregasi dari `JournalLine` per `Account`
- Self-check: `ASET = KEWAJIBAN + EKUITAS`; SHU tahun berjalan yang belum ditutup dilipat ke EKUITAS sebagai baris terhitung "SHU Tahun Berjalan (Belum Ditutup)" karena belum ada jurnal penutup otomatis
- PDF: `GET /api/reports/regulatory/neraca/pdf?asOfDate=`, permission `reports.export`

**Arus Kas** — `GET /api/reports/regulatory/arus-kas?from=&to=`
- Metode langsung, default periode = bulan berjalan
- Mengelompokkan `JournalLine` yang menyentuh akun `Account.isCashEquivalent = true` ke Operasi/Investasi/Pendanaan
- Mengembalikan `catatan` (bukan agregasi) jika tenant belum menandai akun manapun sebagai setara kas (lihat §8.3, `mark-cash-equivalent`)
- PDF: `GET /api/reports/regulatory/arus-kas/pdf?from=&to=`

**Laporan Hasil Usaha (Laba Rugi/SHU)** — `GET /api/reports/regulatory/laporan-hasil-usaha?from=&to=`
- PENDAPATAN − BEBAN untuk periode, default = bulan berjalan
- Tidak otomatis posting jurnal penutup ke akun SHU Tahun Berjalan — Neraca sudah menghitung SHU belum ditutup lewat baris terhitung di atas
- PDF: `GET /api/reports/regulatory/laporan-hasil-usaha/pdf?from=&to=`

**Daftar Pembagian SHU per Anggota** — `GET /api/reports/regulatory/shu-distribution?from=&to=`
- Mengalokasikan SHU periode ke 4 kelompok `ShuDistributionConfig` (§8.5), lalu membagi jasaSimpanan/jasaPinjaman secara proporsional per anggota aktif
- Mengembalikan `catatan` jika `ShuDistributionConfig` belum diset, atau SHU periode tidak positif
- PDF: `GET /api/reports/regulatory/shu-distribution/pdf?from=&to=`

**CALK (Catatan Atas Laporan Keuangan)** — `GET /api/reports/regulatory/calk?from=&to=`
- Bagian numerik (`rincianAset`/`rincianKewajiban`/`rincianEkuitas` dengan saldoAwal/saldoAkhir/mutasi per akun, `rincianPendapatan`/`rincianBeban`, `shuBerjalan`) diturunkan on-demand dari Neraca (awal & akhir periode) dan Laporan Hasil Usaha — tanpa penyimpanan terpisah
- Bagian `narasi` mengembalikan 4 section tetap (`UMUM`/`DASAR_PENYUSUNAN`/`KEBIJAKAN_AKUNTANSI`/`INFORMASI_TAMBAHAN`), diedit sekali oleh tenant lewat `PUT /api/reports/regulatory/calk/narrative` (permission `reports.update`) dan dipakai ulang setiap periode
- Tidak ada varian `/pdf` — narasi CALK di-review/diedit di UI, bukan diekspor sebagai dokumen statis (keputusan desain, §8 spec)

**Belum diimplementasikan:** LPEA (Laporan Promosi Ekonomi Anggota) — butuh spesifikasi kalkulasi sendiri, lihat `docs/handoff.md`.

---

## 8. Modul Sistem Konfigurasi

### 8.1 User Management

**Endpoints:**
- `GET /api/config/users` — list user + role
- `POST /api/config/users` — buat user baru (superadmin only)
- `PUT /api/config/users/:id` — update user
- `DELETE /api/config/users/:id` — nonaktifkan user (soft delete)

### 8.2 Role & Permission Management

**Endpoints:**
- `GET /api/config/roles` — list role tenant
- `POST /api/config/roles` — buat role baru
- `PUT /api/config/roles/:id` — update permission matrix role
- `DELETE /api/config/roles/:id` — hapus role kustom (`requirePermission('roles', 'delete')`)
  - Ditolak dengan `409 ROLE_IN_USE` jika masih ada user yang memakai role tersebut
  - `404 ROLE_NOT_FOUND` jika role tidak ditemukan di tenant

**Permission Matrix per Modul:**
```json
{
  "dashboard":  { "read": true },
  "members":    { "create": true, "read": true, "update": true, "delete": false },
  "savings":    { "create": true, "read": true, "update": true, "delete": false },
  "loans":      { "create": true, "read": true, "update": true, "delete": false },
  "reports":    { "read": true, "export": true, "update": false },
  "config":     { "read": false, "update": false },
  "users":      { "create": false, "read": false, "update": false, "delete": false },
  "roles":      { "create": false, "read": false, "update": false, "delete": false },
  "accounting": { "create": false, "read": false, "update": false, "delete": false }
}
```
`reports.update` mengontrol `PUT /api/reports/regulatory/calk/narrative` (§7.4) — ditambahkan khusus untuk CALK, sebelumnya `reports` hanya punya `read`/`export`. `accounting` mengontrol modul Konfigurasi Akun (§8.3–8.5). Default seed: Super Admin/Manager `reports.update: true`, Teller/Viewer `false`; hanya Super Admin yang punya `accounting: true` secara default.

**Default Roles:**
| Role | Deskripsi |
|------|-----------|
| SUPER_ADMIN | Akses penuh semua modul + config |
| MANAGER | Baca semua + kelola transaksi, tanpa user/role management |
| TELLER | Simpanan + pembayaran cicilan saja |
| VIEWER | Read-only semua modul |

### 8.3 Konfigurasi Akun (Chart of Accounts)

Digated oleh entitlement paket (`"accounting"` di `SubscriptionPackage.modules[]`, `403 FEATURE_NOT_ENTITLED` jika tidak tersedia). Lihat `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md`.

**Endpoints:**
- `GET /api/config/accounts?category=&page=&limit=&search=` — list akun, filter per kategori
- `POST /api/config/accounts` — buat akun; `code` harus sesuai prefiks kategori (1- Aset, 2- Kewajiban, 3- Ekuitas, 4- Pendapatan, 5- Beban), `422 ACCOUNT_CODE_INVALID_FORMAT` jika tidak; `409 ACCOUNT_CODE_DUPLICATE` jika `code` sudah dipakai di tenant
- `PUT /api/config/accounts/:id` — update nama/`isActive`; `code` immutable setelah dibuat
- `DELETE /api/config/accounts/:id` — nonaktifkan (soft delete); `409 ACCOUNT_IN_USE` jika `isDefault=true` atau masih direferensikan `AccountMapping`
- `POST /api/config/accounts/seed-default` — seed template COA standar; no-op/blocked jika tenant sudah punya akun
- `POST /api/config/accounts/:id/mark-cash-equivalent` — toggle `Account.isCashEquivalent`, menentukan pengelompokan Kas/Bank di Laporan Arus Kas (§7.4)

### 8.4 Pemetaan Akun (Account Mapping)

Memetakan sumber transaksi (`SavingConfig`, `LoanConfig`, atau `SYSTEM` tenant-wide) ke akun debit/kredit yang dipakai mesin posting (§7.4) saat menjurnal transaksi.

**Endpoints:**
- `GET /api/config/account-mappings` — list mapping, join dengan nama config sumber + nama akun
- `PUT /api/config/account-mappings` — upsert satu mapping (`sourceType` + `sourceId` + `transactionKind` + akun debit/kredit); `422 MAPPING_ACCOUNT_CATEGORY_MISMATCH` jika kombinasi kategori debit/kredit melanggar arah saldo normal yang diharapkan untuk `transactionKind` tersebut
- `GET /api/config/account-mappings/completeness` — jumlah `transactionKind` yang diharapkan vs. sudah dipetakan, mendorong indikator kelengkapan di UX

### 8.5 Konfigurasi Distribusi SHU

**Endpoints:**
- `GET /api/config/shu-distribution` — ambil `ShuDistributionConfig` tenant (`null` jika belum diset)
- `PUT /api/config/shu-distribution` — upsert; 4 persentase (`jasaSimpanan`/`jasaPinjaman`/`cadangan`/`lainnya`) wajib berjumlah tepat 100 (`422 SHU_DISTRIBUTION_PERCENT_INVALID` jika tidak)

Dipakai laporan Daftar Pembagian SHU per Anggota (§7.4).

### 8.6 Modal Disetor & Notifikasi Ambang Audit

Field kepatuhan umum — **tidak** digated oleh entitlement `"accounting"` (independen dari modul Konfigurasi Akun), hanya `requirePermission('config', ...)`.

**Endpoints:**
- `GET /api/config/modal-disetor` — ambil `Tenant.modalDisetor` + `auditThresholdNotifiedAt`
- `PUT /api/config/modal-disetor` — update `modalDisetor`; `422 MODAL_DISETOR_INVALID` jika nilai negatif

Mendorong cron notifikasi ambang-audit harian (Permenkop UKM No. 2/2024 Pasal 12, Rp5M) — lihat `apps/backend/src/lib/audit-threshold.ts`. Saat `modalDisetor` melewati ambang, sistem membuat `Notification` bertipe `AUDIT_THRESHOLD_EXCEEDED` (§9.5) dan mencatat `auditThresholdNotifiedAt` agar tidak mengirim ulang untuk kondisi yang sama.

---

## 9. Modul Platform Admin

**Base URL:** `admin.siskop.com`

### 9.1 Dashboard Platform
- Total koperasi terdaftar (aktif/nonaktif)
- Total anggota keseluruhan
- Total transaksi platform (30 hari terakhir)
- Grafik pertumbuhan koperasi baru per bulan

### 9.2 Manajemen Tenant

**Endpoints:**
- `GET /api/admin/tenants` — list semua koperasi
- `PUT /api/admin/tenants/:id` — update status (aktif/nonaktif)
- `GET /api/admin/tenants/:id/stats` — statistik per koperasi

### 9.3 Manajemen Paket Langganan

**Endpoints:**
- `GET /api/admin/packages` — list paket langganan
- `POST /api/admin/packages` — buat paket baru
- `PUT /api/admin/packages/:id` — update paket
- `DELETE /api/admin/packages/:id` — nonaktifkan paket (soft delete)

Setiap paket memiliki:
- Nama paket
- Harga per bulan
- Batas jumlah user
- Batas jumlah anggota
- Batas jumlah konfigurasi simpanan custom (`maxSavingConfigs`, kosong = tak terbatas)
- Toggle fitur whitelabel (`whitelabelEnabled`)
- Daftar modul yang diaktifkan (array of module keys)

### 9.4 Upload Logo Koperasi (Host-managed)

**Endpoint:** `POST /api/admin/tenants/:id/logo`

Multipart form upload (`multer`, field `logo`, jpg/png, max 2MB), mengikuti pola upload yang sama dengan `config.router.ts`. File disimpan di `uploads/logos/{tenantId}/logo-{timestamp}.{ext}` dan `Tenant.logoUrl` diperbarui. Digunakan oleh Host dari halaman detail tenant sebagai alternatif jika admin koperasi belum mengunggah logonya sendiri (CFG-02).

### 9.5 Notifikasi Platform (In-App)

**Endpoints:**
- `GET /api/admin/notifications?page=&limit=` — list notifikasi, tiap item menyertakan `isRead` (dihitung per platform admin yang me-request)
- `GET /api/admin/notifications/unread-count` — jumlah belum dibaca untuk platform admin yang me-request
- `POST /api/admin/notifications/:id/read` — tandai satu notifikasi dibaca
- `POST /api/admin/notifications/read-all` — tandai semua notifikasi dibaca

**Event yang memicu notifikasi (`NotificationType`):**
| Type | Trigger | Sumber |
|------|---------|--------|
| `TENANT_REGISTERED` | Koperasi baru mendaftar | `auth.service.ts` → `registerTenant` (dalam transaksi yang sama) |
| `BILLING_BLOCKED` | Koperasi diblokir otomatis karena tagihan lewat jatuh tempo | `billing.ts` → `processBillingReminders` |
| `PACKAGE_CHANGED` | Paket langganan koperasi diubah oleh platform admin | `admin.service.ts` → `updateTenant` (saat `packageId` berubah) |
| `AUDIT_THRESHOLD_EXCEEDED` | `Tenant.modalDisetor` melewati ambang wajib-audit Permenkop UKM No. 2/2024 Pasal 12 (Rp5M) | `apps/backend/src/lib/audit-threshold.ts`, cron harian (lihat §8.6) |

**Model penyimpanan status baca:** `Notification` (event log, shared antar semua platform admin) + `NotificationRead` (baris per user per notifikasi; ketiadaan baris = belum dibaca). Ini memastikan satu platform admin menandai baca tidak memengaruhi status baca admin lain.

### 9.6 Manajemen User Platform Admin

**Endpoints:**
- `GET /api/admin/users` — list user dengan `isPlatformAdmin = true`
- `POST /api/admin/users` — buat platform admin baru (mewarisi `tenantId`/`roleId` dari pembuatnya — bukan entitas tenant biasa)
- `PUT /api/admin/users/:id` — update nama/email/`isActive` (dipakai juga untuk aktivasi kembali)
- `DELETE /api/admin/users/:id` — nonaktifkan platform admin (soft delete)
  - `400 CANNOT_DEACTIVATE_SELF` jika platform admin mencoba menonaktifkan akunnya sendiri

---

## 10. Format Data Global

### 10.1 Response Envelope
```json
// Sukses
{ "success": true, "data": {}, "meta": {} }

// Error
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Pesan error", "details": {} } }
```

### 10.2 Format Mata Uang
- Semua nominal disimpan sebagai `Decimal` di database PostgreSQL
- API selalu mengembalikan nominal sebagai **string** (bukan number) untuk menghindari floating-point imprecision
- Frontend menggunakan fungsi `formatRupiah()` dari shared package

### 10.3 Pagination
Semua list endpoint mendukung:
```
?page=1&limit=20&search=&sortBy=createdAt&sortOrder=desc
```

### 10.4 Error Codes
| Code | Deskripsi |
|------|-----------|
| `UNAUTHORIZED` | Tidak ada token atau token invalid |
| `FORBIDDEN` | Token valid tapi tidak punya permission |
| `TENANT_NOT_FOUND` | Subdomain tidak terdaftar |
| `MEMBER_NOT_FOUND` | ID anggota tidak ditemukan |
| `LOAN_NOT_FOUND` | ID pinjaman tidak ditemukan |
| `MEMBER_HAS_NO_POKOK_SAVING` | Anggota belum punya simpanan pokok |
| `MEMBER_HAS_EXISTING_LOAN` | Anggota sudah punya pinjaman aktif |
| `INSUFFICIENT_BALANCE` | Saldo simpanan tidak mencukupi |
| `VALIDATION_ERROR` | Input tidak valid (detail di `errors` field) |
| `PACKAGE_LIMIT_EXCEEDED` | Paket tenant tidak mengizinkan penambahan resource ini (mis. kuota konfigurasi simpanan custom) |
| `FEATURE_NOT_ENTITLED` | Paket tenant tidak mencakup fitur ini (mis. whitelabel) |
| `ROLE_IN_USE` | Role tidak bisa dihapus — masih dipakai satu atau lebih user |
| `ROLE_NOT_FOUND` | ID role tidak ditemukan di tenant |
| `NOTIFICATION_NOT_FOUND` | ID notifikasi tidak ditemukan |
| `CANNOT_DEACTIVATE_SELF` | Platform admin tidak bisa menonaktifkan akunnya sendiri |
| `DOMAIN_ALREADY_USED` | Domain kustom sudah dipakai tenant lain |
| `ACCOUNT_CODE_INVALID_FORMAT` | Kode akun tidak sesuai prefiks kategori (§8.3) |
| `ACCOUNT_CODE_DUPLICATE` | Kode akun sudah dipakai di tenant |
| `ACCOUNT_IN_USE` | Akun tidak bisa dihapus/dinonaktifkan — `isDefault=true` atau masih dipakai `AccountMapping` |
| `ACCOUNT_NOT_FOUND` | ID akun tidak ditemukan di tenant |
| `MAPPING_ACCOUNT_CATEGORY_MISMATCH` | Pilihan akun debit/kredit melanggar arah saldo normal untuk `transactionKind` tersebut |
| `JOURNAL_ENTRY_UNBALANCED` | Guard rail internal — `SUM(debit) != SUM(credit)` sebelum commit; seharusnya tidak pernah sampai ke client |
| `REPORT_PERIOD_INVALID` | Range tanggal `from`/`to` laporan tidak valid (mis. `from > to`) |
| `SHU_DISTRIBUTION_PERCENT_INVALID` | 4 persentase `ShuDistributionConfig` tidak berjumlah tepat 100 |
| `MODAL_DISETOR_INVALID` | Nilai `Tenant.modalDisetor` negatif |

> Lihat juga `Docs/api-conventions.md` untuk daftar lengkap dan HTTP status masing-masing kode error di atas — dokumen ini fokus pada kapan tiap error dipicu.
