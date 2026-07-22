# Design Spec — Pelaporan Regulasi Keuangan (Journal Posting Engine + Laporan Keuangan Wajib)
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Modul** | Tenant — Akuntansi (lanjutan Konfigurasi Akun) → Laporan Keuangan |
| **Tanggal** | 22 Juli 2026 |
| **Status** | Draft — for panel review |
| **Terkait** | `Docs/regulatory-reporting-requirements.md` (legal basis), `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md` §10/§10a (Phase 2/3 roadmap this spec fulfills), `Docs/01-PRD-SISKOP.md` §6.6 (RPT-01–07), §8 (Out of Scope v1.0), `Docs/api-conventions.md` |
| **Disclaimer** | Sama seperti sumbernya (`regulatory-reporting-requirements.md`): ini referensi perencanaan produk, bukan nasihat hukum. Tenggat, ambang, dan ketentuan di bawah harus diverifikasi ke teks regulasi primer sebelum di-hardcode sebagai penegakan (enforcement) — lihat §7 dan §11. |

---

## 1. Background & Problem

`Docs/regulatory-reporting-requirements.md` (riset panel 21 Juli 2026) memastikan bahwa Permenkop UKM No. 2/2024 mewajibkan setiap koperasi — termasuk KSP/KSPPS closed-loop sederhana yang jadi model tenant SISKOP hari ini — untuk menyusun 5 laporan keuangan selaras SAK EP: **Neraca**, **Laporan Perhitungan Hasil Usaha**, **Laporan Arus Kas**, **Laporan Promosi Ekonomi Anggota (LPEA)**, dan **Catatan Atas Laporan Keuangan (CALK)**. Kewajiban ini sudah berlaku sejak tahun buku 2025 — bukan sesuatu yang bisa ditunda.

SISKOP saat ini punya dua potongan fondasi yang relevan tapi belum tersambung:
- **RPT-01/RPT-02** (`apps/backend/src/modules/reports/`): agregat manual dari `SavingTransaction`/`LoanPayment`, bukan laporan keuangan resmi berbasis buku besar. Tetap berjalan independen (§13).
- **Konfigurasi Akun** (`2026-07-21-konfigurasi-akun-coa-design.md`, Phase 1): `Account` + `AccountMapping` sudah punya skema COA hierarkis dan pemetaan transaksi ke akun, tapi **tidak ada mesin jurnal** — mapping ini belum pernah dipakai untuk memposting apa pun.

Spec ini adalah **Phase 2 + Phase 3** yang dirujuk di `konfigurasi-akun-coa-design.md` §10: mesin posting jurnal, lalu laporan keuangan yang diturunkan dari saldo buku besar. Ini bukan implementasi langsung — spec ini disiapkan agar Phase 2/3 bisa dieksekusi di sesi kerja terpisah, karena scope-nya besar (skema baru, logika posting untuk setiap jenis transaksi, dan generator 5 laporan).

## 2. Scope

**Termasuk:**
1. `JournalEntry`/`JournalLine` — buku besar berpasangan (double-entry), diposting otomatis dari `SavingTransaction`, `LoanPayment`, dan pencairan pinjaman, memakai `AccountMapping` yang sudah ada.
2. Generator **Neraca** dan **Laporan Arus Kas** — murni derivasi saldo dari `JournalLine` per kategori akun.
3. Generator **Laporan Perhitungan Hasil Usaha** — derivasi Pendapatan − Beban dari `JournalLine`, dengan pemisahan transaksi-dengan-anggota vs. bukan-anggota (SAK EP mensyaratkan pemisahan ini; SISKOP saat ini closed-loop sehingga "bukan anggota" defaultnya nol, tapi kolomnya tetap disediakan agar tidak butuh migrasi ulang jika §2.5/RUU berubah).
4. **Daftar Pembagian SHU per Anggota** — laporan turunan dari Laporan Hasil Usaha + formula distribusi yang dikonfigurasi tenant (§6.4).
5. **CALK** — sebagian besar naratif (kebijakan akuntansi, penjelasan pos), dengan bagian angka (rincian saldo akun) di-generate otomatis dari COA/jurnal.
6. Field **modal/aset tenant** dan notifikasi ambang audit wajib Rp5 miliar (Permenkop 2/2024 Pasal 12), sesuai rekomendasi Backend di `konfigurasi-akun-coa-design.md` §10a.
7. Reminder tenggat pelaporan periodik (§7), dengan verifikasi eksplisit sebagai prasyarat sebelum enforcement (lihat catatan konsistensi tenggat di §7).

**Tidak termasuk (lihat §13 untuk daftar lengkap):**
- **Laporan Promosi Ekonomi Anggota (LPEA)** sebagai output otomatis penuh — LPEA bukan laporan turunan saldo akun (`regulatory-reporting-requirements.md` §2.1 baris 4; `konfigurasi-akun-coa-design.md` §10a "Compliance" takeaway). Spec ini hanya menyiapkan sumber data mentah yang dibutuhkan (§6.5); kalkulasi manfaat ekonomi per anggota per kategori butuh spec kalkulasi terpisah.
- Dokumen governance RAT yang bukan turunan ledger: Laporan Pertanggungjawaban Pengurus, Laporan Pengawas, Rancangan Rencana Kerja & RAPBK — direkomendasikan jadi "Modul RAT" terpisah (§13), konsisten dengan `konfigurasi-akun-coa-design.md` §10a takeaway Product.
- Laporan Audit Akuntan Publik itu sendiri — output eksternal, bukan output sistem (§6.6 hanya menyediakan data auditable).
- Pelaporan gaya-OJK untuk Koperasi Sektor Jasa Keuangan (KSJK, POJK 47/2024) — tidak relevan untuk model tenant closed-loop SISKOP saat ini; tetap item pemantauan (§14), bukan sesuatu yang dibangun.
- Ketentuan RUU Perkoperasian (belum disahkan per 21 Juli 2026) — directional, bukan actionable (§14).
- Migrasi historis `SavingTransaction`/`LoanPayment` ke jurnal — mengikuti asumsi Phase 1, posting hanya berlaku forward dari tanggal go-live Phase 2.

## 3. Panel Discussion

**Product (scope & sequencing)**
Phase 2+3 ini besar — jangan coba dikerjakan sebagai satu PR. Urutan realistis: (a) skema jurnal + posting engine untuk transaksi baru dulu, tervalidasi dengan trial balance yang selalu balance; (b) Neraca + Arus Kas (murni agregasi saldo, risiko rendah begitu jurnal benar); (c) Laporan Hasil Usaha + Daftar SHU (butuh keputusan formula distribusi SHU, lihat §6.4); (d) CALK (banyak bagian tetap manual/naratif — jangan janjikan otomatisasi penuh); LPEA sengaja **ditunda** karena butuh spec kalkulasi sendiri. Tetap gate di belakang entitlement `"accounting"` yang sama seperti Phase 1.

**Accounting/Compliance SME**
Poin kritis: laporan ini akan dipakai koperasi untuk RAT dan (bagi tenant ≥Rp5 miliar modal) diaudit akuntan publik terdaftar Kemenkop. Itu berarti trial balance **harus** selalu balance (total debit = total kredit per periode) — tidak ada toleransi silent-rounding. Simpanan Pokok/Wajib diposting sebagai Ekuitas dan Simpanan Sukarela sebagai Kewajiban mengikuti mapping tenant dari Phase 1 (bukan hardcoded ulang di sini). SHU (Sisa Hasil Usaha) itu sendiri harus dipisahkan "tahun berjalan" (belum dibagi, di neraca sebagai ekuitas) vs. "dibagikan" (mengurangi ekuitas, jadi liabilitas sementara ke anggota sampai dibayarkan) — ini pola akuntansi koperasi standar, bukan spesifik SISKOP.

**Backend Engineer**
- Posting harus **transaksional**: setiap `SavingTransaction`/`LoanPayment`/pencairan yang punya mapping lengkap men-generate `JournalEntry` + minimal 2 `JournalLine` (debit & kredit) dalam satu DB transaction dengan record sumbernya — gagal posting tidak boleh gagal-diam-diam pada transaksi simpan-pinjam itu sendiri (SAV-01/LOAN-01 tetap harus jalan meski akuntansi belum lengkap, konsisten dengan prinsip Phase 1).
- Kalau `AccountMapping` untuk suatu `transactionKind` belum ada saat transaksi terjadi, **jangan block** transaksi simpan-pinjamnya — skip posting dan tandai transaksi itu "belum terposting" (lihat `postingStatus` di §5.1) supaya bisa di-backfill/reposting manual nanti setelah mapping dilengkapi tenant.
- Neraca/Arus Kas/Laporan Hasil Usaha dihitung on-demand dari agregasi `JournalLine` per periode (tidak perlu tabel snapshot terpisah di v1) — cache di layer aplikasi kalau performa jadi masalah nanti, bukan concern awal.
- Field modal/aset tenant untuk ambang audit: tambahkan ke `Tenant`, bukan `SubscriptionPackage` (ini properti tenant individual, bukan properti paket).

**Frontend/UX**
Laporan-laporan ini harus ikut pola PDF export yang sudah ada di RPT-01/02 (header logo+nama+alamat, footer nama+nomor halaman — RPT-04/05/06), supaya konsisten dan langsung siap-cetak untuk RAT. Untuk CALK, sediakan editor teks kaya (rich text) per bagian naratif yang bisa diedit tenant, dengan bagian angka ter-inject read-only dari data — jangan generate CALK sebagai blob teks yang tidak bisa disunting.

**Resolved by group**
- Scope dibatasi ke Neraca, Laporan Perhitungan Hasil Usaha, Laporan Arus Kas, Daftar Pembagian SHU per Anggota, dan CALK (sebagian). LPEA penuh ditunda sampai ada spec kalkulasi terpisah.
- Posting engine forward-only, tidak backfill histori.
- Mapping yang belum lengkap tidak memblokir transaksi — konsisten dengan keputusan Phase 1.
- Gate di belakang entitlement `"accounting"` yang sama dengan Phase 1 (bukan modul baru).

## 4. Resolved Decisions

| Question | Decision |
|---|---|
| Backfill histori transaksi lama ke jurnal? | Tidak. Posting forward-only sejak go-live Phase 2 (sama seperti asumsi Phase 1 §11). |
| Mapping belum lengkap memblokir transaksi simpan-pinjam? | Tidak. Transaksi tetap jalan; posting jurnalnya di-skip dan ditandai `UNPOSTED_MISSING_MAPPING` untuk reposting manual nanti. |
| LPEA masuk scope ini? | Tidak — butuh spec kalkulasi terpisah (§2, §6.5). Hanya sumber data mentah yang disiapkan. |
| Dokumen governance RAT (Laporan Pertanggungjawaban Pengurus, Laporan Pengawas, RAPBK) masuk scope ini? | Tidak — modul terpisah di roadmap lain, bukan bagian modul akuntansi. |
| Neraca/Arus Kas/Laporan Hasil Usaha disimpan sebagai snapshot atau dihitung on-demand? | On-demand dari agregasi `JournalLine`. Snapshot/cache adalah optimisasi nanti, bukan keputusan v1. |
| Trial balance boleh tidak seimbang (rounding dsb.)? | Tidak pernah. Setiap `JournalEntry` divalidasi debit=kredit sebelum commit; entry yang gagal validasi tidak pernah tersimpan. |
| Formula distribusi SHU per anggota hardcoded? | Tidak. Dikonfigurasi tenant (§6.4), karena praktik pembagian SHU koperasi bervariasi (proporsi jasa simpan vs. jasa pinjam vs. lainnya) dan tidak diatur seragam oleh regulasi. |
| Field modal/aset ambang audit ditaruh di mana? | `Tenant.modalDisetor` (baru) — properti tenant, bukan `SubscriptionPackage`. |
| Tenggat pelaporan periodik (§7) langsung dijadikan reminder otomatis? | Tidak sebelum diverifikasi ke teks Permenkop 2/2024 — ada indikasi inkonsistensi urutan tenggat di sumber sekunder (lihat `regulatory-reporting-requirements.md` §2.1 catatan). Reminder dibangun dengan tenggat sebagai data terkonfigurasi, bukan hardcode tervalidasi, sampai diverifikasi. |
| Entitlement gating? | Sama dengan Phase 1 — `"accounting"` di `SubscriptionPackage.modules[]`, tidak ada modul baru. |

## 5. Data Model

### 5.1 `JournalEntry` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `tenantId` | String, FK | Tenant isolation |
| `entryDate` | DateTime | Tanggal transaksi (bukan tanggal posting/`createdAt`) |
| `sourceType` | Enum `JournalSourceType` | `SAVING_TRANSACTION \| LOAN_PAYMENT \| LOAN_DISBURSEMENT \| MANUAL` |
| `sourceId` | String, nullable | FK ke `SavingTransaction.id` / `LoanPayment.id` / `Loan.id`; `null` untuk `MANUAL` |
| `description` | String | Auto-generated, mis. "Setoran simpanan — {memberName}" |
| `status` | Enum `JournalEntryStatus` | `POSTED \| UNPOSTED_MISSING_MAPPING` |
| `createdAt` | DateTime | Waktu posting aktual |

**Index:** `tenantId`, `entryDate`, `(sourceType, sourceId)`

### 5.2 `JournalLine` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `journalEntryId` | String, FK | |
| `tenantId` | String, FK | Denormalized untuk query langsung tanpa join (konsisten pola tenant-scoped lain di ERD) |
| `accountId` | String, FK → `Account` | |
| `debit` | Decimal(15,2) | 0 jika baris ini kredit |
| `credit` | Decimal(15,2) | 0 jika baris ini debit |

**Constraint:** per `JournalEntry`, `SUM(debit) = SUM(credit)` — divalidasi di application layer sebelum commit (bukan DB constraint, karena butuh agregasi lintas baris). **Index:** `tenantId`, `accountId`, `journalEntryId`

### 5.3 `Tenant` (extend — Phase 1 sudah ada relasi `accounts`/`accountMappings`)

Tambahan field:

| Column | Type | Notes |
|---|---|---|
| `modalDisetor` | Decimal(15,2), nullable | Modal koperasi tahun buku berjalan — input manual tenant (bukan derivasi otomatis dari neraca, karena definisi "modal" untuk ambang Pasal 12 mungkin tidak identik dengan total ekuitas neraca; perlu verifikasi, lihat §11) |
| `auditThresholdNotifiedAt` | DateTime, nullable | Kapan notifikasi ambang Rp5M terakhir dikirim, hindari spam berulang |

### 5.4 `ShuDistributionConfig` (new)

Formula pembagian SHU per anggota — dikonfigurasi tenant, bukan hardcoded.

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `tenantId` | String, FK, unique | Satu konfigurasi aktif per tenant (v1) |
| `jasaSimpananPercent` | Decimal(5,2) | % SHU dialokasikan proporsional saldo simpanan anggota |
| `jasaPinjamanPercent` | Decimal(5,2) | % SHU dialokasikan proporsional jasa/bunga pinjaman yang dibayar anggota |
| `cadanganPercent` | Decimal(5,2) | % SHU ditahan sebagai cadangan (tidak dibagi) |
| `lainnyaPercent` | Decimal(5,2) | Sisa alokasi (dana pengurus/pengawas/sosial dst., sesuai AD/ART masing-masing koperasi) |
| `updatedAt` | DateTime | |

**Validasi:** jumlah 4 kolom persentase = 100.00, di-enforce di service layer.

### 5.5 Sumber Data LPEA (bukan LPEA itu sendiri — hanya penyiapan, §2)

Tidak ada model baru diperlukan untuk sumber data mentah — LPEA per definisinya butuh: (a) bunga/bagi-hasil simpanan diterima per anggota → sudah ada di `SavingTransaction` bertipe bunga jika ada, atau perlu dicek apakah bunga simpanan diposting sebagai transaksi terpisah; (b) selisih bunga pinjaman anggota vs. bunga pasar acuan → butuh field "bunga pasar acuan" yang belum ada di mana pun. **Ini bagian dari gap yang harus diisi spec kalkulasi LPEA terpisah, dicatat sebagai open item (§14), bukan diselesaikan di sini.**

### Prisma sketch (Phase 2 core)

```prisma
enum JournalSourceType {
  SAVING_TRANSACTION
  LOAN_PAYMENT
  LOAN_DISBURSEMENT
  MANUAL
}

enum JournalEntryStatus {
  POSTED
  UNPOSTED_MISSING_MAPPING
}

model JournalEntry {
  id          String             @id @default(cuid())
  tenantId    String
  tenant      Tenant             @relation(fields: [tenantId], references: [id])
  entryDate   DateTime
  sourceType  JournalSourceType
  sourceId    String?
  description String
  status      JournalEntryStatus @default(POSTED)
  createdAt   DateTime           @default(now())

  lines JournalLine[]

  @@index([tenantId])
  @@index([entryDate])
  @@index([sourceType, sourceId])
}

model JournalLine {
  id             String       @id @default(cuid())
  journalEntryId String
  journalEntry   JournalEntry @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  tenantId       String
  tenant         Tenant       @relation(fields: [tenantId], references: [id])
  accountId      String
  account        Account      @relation(fields: [accountId], references: [id])
  debit          Decimal      @default(0) @db.Decimal(15, 2)
  credit         Decimal      @default(0) @db.Decimal(15, 2)

  @@index([tenantId])
  @@index([accountId])
  @@index([journalEntryId])
}

model ShuDistributionConfig {
  id                   String   @id @default(cuid())
  tenantId             String   @unique
  tenant               Tenant   @relation(fields: [tenantId], references: [id])
  jasaSimpananPercent  Decimal  @db.Decimal(5, 2)
  jasaPinjamanPercent  Decimal  @db.Decimal(5, 2)
  cadanganPercent      Decimal  @db.Decimal(5, 2)
  lainnyaPercent       Decimal  @db.Decimal(5, 2)
  updatedAt            DateTime @updatedAt
}
```

`Account` (Phase 1) needs a back-relation added: `journalLines JournalLine[]`.

## 6. Report Generation Logic

### 6.1 Neraca (Balance Sheet)

`SUM(JournalLine.debit - JournalLine.credit)` per `Account`, dari awal berdirinya buku besar sampai tanggal cutoff, disesuaikan tanda per `normalBalance` — lalu digroup oleh `Account.category`/`parentId` mengikuti hierarki COA. **ASET** = **KEWAJIBAN** + **EKUITAS** harus selalu sama (properti aritmatika dari trial balance yang selalu balance, §4) — dipakai sebagai self-check, bukan hanya tampilan.

### 6.2 Laporan Perhitungan Hasil Usaha

`SUM` saldo akun kategori **PENDAPATAN** dikurangi **BEBAN** untuk suatu periode (bukan sejak awal — pakai `entryDate` range). Dipecah per baris akun (bukan hanya total), dengan sub-total terpisah untuk pendapatan/beban dari transaksi anggota vs. bukan-anggota (§2 poin 3) — untuk model tenant closed-loop hari ini, kolom "bukan anggota" akan selalu nol, tapi strukturnya tetap ada. Hasil akhir = SHU periode berjalan, yang lalu diposting sebagai jurnal penutup ke akun `3-3000 SHU Tahun Berjalan` (akun ini sudah ada di template default Phase 1 §4).

### 6.3 Laporan Arus Kas

Metode langsung (direct method) lebih sesuai untuk koperasi kecil-menengah dibanding metode tidak langsung yang butuh rekonsiliasi laba-ke-kas yang kompleks: kelompokkan `JournalLine` yang menyentuh akun Kas/Bank (`1-1000`/`1-1010` di template default, atau akun manapun yang tenant tandai sebagai kas-setara-kas) menjadi tiga bagian — **Operasi** (setoran/penarikan simpanan, pembayaran cicilan, biaya operasional), **Investasi** (pembelian aset tetap), **Pendanaan** (setoran modal, jika ada). Kategorisasi per `JournalSourceType`/`Account.category` yang berlawanan dengan sisi kas dari tiap entry.

### 6.4 Daftar Pembagian SHU per Anggota

Input: SHU periode berjalan (dari §6.2) × `ShuDistributionConfig` tenant → alokasi total per kategori (jasa simpanan / jasa pinjaman / cadangan / lainnya) → dibagi proporsional per anggota berdasarkan (a) rata-rata saldo simpanan anggota selama periode untuk kategori jasa simpanan, (b) total jasa/bunga pinjaman yang dibayar anggota selama periode untuk kategori jasa pinjaman. Output: satu baris per anggota aktif dengan breakdown dan total SHU diterima.

### 6.5 CALK (Catatan Atas Laporan Keuangan)

Bukan laporan yang bisa di-generate penuh secara otomatis. V1: template dengan bagian tetap (kebijakan akuntansi — referensi SAK EP, dasar penyusunan) sebagai rich-text yang diedit tenant sekali dan dipakai ulang tiap periode, digabung dengan bagian angka yang di-inject read-only dari Neraca/Laporan Hasil Usaha (rincian saldo per akun, mutasi signifikan). Tidak ada logika "kalkulasi" tambahan di luar apa yang sudah dihasilkan §6.1/§6.2.

### 6.6 Notifikasi Ambang Audit Wajib (Permenkop 2/2024 Pasal 12)

Cron harian (bisa gabung ke `apps/backend/src/jobs/` yang sudah ada pola dari `kol-cron.ts`): untuk tiap tenant dengan `modalDisetor` terisi, jika `modalDisetor >= 5_000_000_000` dan `auditThresholdNotifiedAt` null atau lebih lama dari periode saat ini, kirim notifikasi in-app (pola `Notification` model yang sudah ada) — pengingat kepatuhan, **bukan** penegakan otomatis (tidak memblokir fitur apa pun). Set `auditThresholdNotifiedAt` setelah terkirim.

## 7. Tenggat Pelaporan — Status Verifikasi

`regulatory-reporting-requirements.md` §2.1 mencantumkan tenggat berikut, tapi secara eksplisit menandai urutan semesteran (20 Juni) vs. triwulanan II (20 Juli) sebagai **janggal secara logis dan kemungkinan kesalahan sumber sekunder**:

| Jenis Laporan | Tenggat (belum terverifikasi ke Permenkop 2/2024 langsung) |
|---|---|
| Tahunan — koperasi primer | 30 April tahun berikutnya |
| Tahunan — koperasi sekunder | 30 Juni tahun berikutnya |
| Triwulanan I | 20 April |
| Triwulanan II | 20 Juli |
| Triwulanan III | 20 Oktober |
| Semesteran | 20 Juni |

**Keputusan:** tenggat-tenggat ini disimpan sebagai **data terkonfigurasi** (mis. `SystemConfig`-style JSON per tenant atau tabel referensi platform-level — desain detail di sesi implementasi), bukan hardcode di kode aplikasi, dan reminder berbasis tenggat ini **tidak diaktifkan sebagai default terkirim** sampai seseorang memverifikasi ke teks Permenkop UKM No. 2/2024 pasal terkait secara langsung. Ini mengikuti rekomendasi eksplisit `regulatory-reporting-requirements.md` §5 poin 1.

## 8. API Endpoints (new)

Mengikuti konvensi envelope & namespacing yang ada (`Docs/api-conventions.md`), di bawah gate entitlement `"accounting"` yang sama dengan Phase 1.

```
GET    /api/reports/regulatory/neraca?asOfDate=                 Neraca per tanggal cutoff
GET    /api/reports/regulatory/neraca/pdf?asOfDate=              Export PDF (header/footer sesuai RPT-04/05/06)
GET    /api/reports/regulatory/laporan-hasil-usaha?from=&to=      Laporan Perhitungan Hasil Usaha untuk periode
GET    /api/reports/regulatory/laporan-hasil-usaha/pdf?from=&to=
GET    /api/reports/regulatory/arus-kas?from=&to=                Laporan Arus Kas untuk periode
GET    /api/reports/regulatory/arus-kas/pdf?from=&to=
GET    /api/reports/regulatory/shu-distribution?from=&to=        Daftar Pembagian SHU per Anggota
GET    /api/reports/regulatory/shu-distribution/pdf?from=&to=
GET    /api/reports/regulatory/calk?from=&to=                    CALK (bagian angka ter-generate + naratif tersimpan)
PUT    /api/reports/regulatory/calk/narrative                    Simpan/update bagian naratif CALK (rich text)

PUT    /api/config/shu-distribution                              Upsert ShuDistributionConfig (4 persentase, harus total 100)
GET    /api/config/shu-distribution

PUT    /api/config/tenant/modal-disetor                          Update Tenant.modalDisetor (kepatuhan ambang audit)

POST   /api/config/accounts/:id/mark-cash-equivalent             Tandai akun sebagai bagian "Kas & Setara Kas" untuk klasifikasi Arus Kas (§6.3)
```

Endpoint jurnal (`JournalEntry`/`JournalLine`) sengaja **tidak** diekspos sebagai CRUD publik di v1 — posting selalu otomatis dari sumber transaksi (§5.1), tidak ada input manual jurnal di scope ini. Kalau kebutuhan jurnal manual (`MANUAL` sourceType) muncul, itu perluasan API terpisah, bukan bagian dari spec ini.

## 9. Error Codes (new)

| Code | HTTP | Description |
|---|---|---|
| `JOURNAL_ENTRY_UNBALANCED` | 500 (internal — seharusnya tak pernah sampai ke client) | Guard rail server-side: `SUM(debit) != SUM(credit)` terdeteksi sebelum commit, entry dibatalkan |
| `SHU_DISTRIBUTION_PERCENT_INVALID` | 422 | Jumlah 4 persentase `ShuDistributionConfig` bukan 100.00 |
| `REPORT_PERIOD_INVALID` | 422 | Range tanggal `from`/`to` tidak valid (mis. `from > to`) |
| `MODAL_DISETOR_INVALID` | 422 | Nilai `modalDisetor` negatif atau bukan angka valid |

Tambahkan ke `Docs/api-conventions.md` saat implementasi.

## 10. Enforcement

- **Package entitlement:** sama seperti Phase 1 — semua endpoint §8 butuh `"accounting"` di `req.tenant.package.modules`, else `403 FEATURE_NOT_ENTITLED`.
- **Posting atomicity:** pembuatan `JournalEntry` + `JournalLine` dalam satu `prisma.$transaction`, dipanggil dari service layer `SavingTransaction`/`LoanPayment`/pencairan yang sudah ada — bukan side-effect terpisah yang bisa gagal-diam-diam.
- **Balance guard:** validasi `SUM(debit) = SUM(credit)` di application layer sebelum commit; kegagalan validasi membatalkan seluruh transaction (termasuk `JournalEntry`-nya), bukan hanya skip baris yang salah.
- **Non-blocking mapping:** jika mapping untuk `transactionKind` tertentu belum lengkap, transaksi sumber (`SavingTransaction`/`LoanPayment`) tetap commit normal; `JournalEntry` terkait diberi status `UNPOSTED_MISSING_MAPPING` untuk direposting manual setelah tenant melengkapi mapping (bukan `403`/block).
- **Permission matrix:** endpoint laporan regulasi di bawah kunci permission `"reports"` yang sudah ada (bukan kunci baru) — konsisten dengan RPT-01/02 hari ini menggunakan `requirePermission('reports', ...)`.

## 11. Open Items Requiring Legal/Accounting Verification

Dibawa dari `regulatory-reporting-requirements.md`, tidak diselesaikan di spec ini:

- Urutan tenggat semesteran vs. triwulanan II (§7) — verifikasi ke teks Permenkop UKM No. 2/2024 langsung sebelum reminder tenggat diaktifkan default-on.
- Apakah "Laporan Perubahan Ekuitas" perlu jadi laporan ke-6 terpisah (sumber campuran SAK ETAP vs. SAK EP) — materi sosialisasi resmi IAI hanya sebut 5, tapi perlu konfirmasi final sebelum dianggap final di produk.
- Definisi persis "modal" untuk ambang Rp5 miliar Pasal 12 — apakah identik dengan total Ekuitas di Neraca hasil Phase 2, atau definisi modal yang berbeda (mis. hanya Simpanan Pokok+Wajib, tanpa cadangan/SHU tertahan)? Ini menentukan apakah `Tenant.modalDisetor` (§5.3) sebaiknya jadi input manual (keputusan saat ini) atau bisa didekati dari Neraca begitu Phase 2 berjalan cukup lama untuk tenant bersangkutan.

## 12. Explicit Assumptions

- Posting forward-only sejak go-live Phase 2; tidak ada migrasi data historis `SavingTransaction`/`LoanPayment` ke jurnal (konsisten dengan asumsi Phase 1 §11).
- Model tenant SISKOP tetap closed-loop (simpan-pinjam murni antar anggota sendiri) selama spec ini berlaku — kolom pemisahan anggota/bukan-anggota di §6.2 disiapkan strukturnya tapi tidak aktif secara substantif sampai model tenant berubah.
- Satu `ShuDistributionConfig` aktif per tenant (tidak ada histori versi formula per tahun buku di v1) — kalau tenant mengganti formula di tengah tahun, distribusi SHU tahun berjalan memakai formula yang aktif saat laporan digenerate, bukan snapshot per periode. Diterima sebagai batasan v1, bukan bug.
- Metode Arus Kas langsung (direct method), bukan tidak langsung — dipilih karena lebih sederhana untuk diturunkan langsung dari `JournalLine` tanpa rekonsiliasi laba-ke-kas tambahan.

## 13. Out of Scope (this spec)

- Laporan Promosi Ekonomi Anggota (LPEA) sebagai output otomatis penuh — butuh spec kalkulasi terpisah (§2, §6.5, §14 turunan).
- Modul RAT/Governance: Laporan Pertanggungjawaban Pengurus, Laporan Pengawas, Rancangan Rencana Kerja & RAPBK — modul terpisah di roadmap lain.
- Laporan Audit Akuntan Publik itu sendiri — eksternal, sistem hanya menyediakan Neraca+CALK auditable.
- Pelaporan gaya-OJK untuk KSJK (POJK 47/2024) — item pemantauan, tidak dibangun (§14).
- Perubahan mengikuti RUU Perkoperasian — belum disahkan, directional saja.
- Endpoint CRUD jurnal manual (`MANUAL` sourceType tetap ada di enum untuk masa depan, tapi tidak ada API-nya di spec ini).
- Migrasi histori transaksi lama ke jurnal.
- Perubahan pada RPT-01/RPT-02 — tetap berjalan independen seperti sebelumnya (catatan: eksplorasi kode menemukan kemungkinan ketidaksesuaian shape data antara `reports.service.ts` dan `ReportsPage.tsx` di frontend saat ini — di luar scope spec ini, tapi layak diperiksa terpisah sebelum RPT-01/02 dianggap berfungsi penuh).
- Multi-currency atau akuntansi konsolidasi lintas-tenant (mengikuti batasan Phase 1 §11).

## 14. Monitoring Items (bukan actionable, tapi jangan hilang dari radar)

- **RUU Perkoperasian** — pantau sepanjang 2026; jika disahkan, revisi spec ini terutama terkait pemisahan closed-loop/open-loop dan potensi LPS Koperasi.
- **KSJK/POJK 47/2024** — pantau jika arah produk SISKOP bergeser ke fitur pendanaan antar-koperasi atau penghimpunan dana dari luar anggota; saat itu terjadi, kewajiban pelaporan OJK terpisah (di luar arsitektur spec ini) perlu spec sendiri.
