# Development Plan — Koperasi Pasar (KOPPAS)

> Tanggal: 2026-09-26 · Branch kerja: `claude/busy-ramanujan-cujt2s`
> Dasar: `docs/research/2026-09-26-koperasi-pasar-gap-mvp.md` (kode gap L1–L8, C1–C10, M1–M2,
> K1–K3 merujuk ke dokumen itu).

## Context

Target MVP: satu KOPPAS **yang mengelola pasar** bisa menjalankan, dari satu tenant:
pinjaman dengan angsuran harian/mingguan, penagihan oleh kolektor yang uangnya bisa ditelusuri
sampai jurnal, serta sewa kios/los dan retribusi harian pedagang.

### Keputusan (dari user, 2026-09-26)

| # | Keputusan | Dampak ke desain |
|---|---|---|
| D1 | Hari Minggu dan hari libur **tidak ada penagihan** | Jadwal angsuran & tagihan retribusi dibuat **per hari operasional**: skip Minggu + daftar hari libur per tenant (`TenantHoliday`). Jatuh tempo yang jatuh di hari libur digeser ke hari operasional berikutnya. |
| D2 | KOL **sesuai saat ini** | `getKOLCategory` (≤30/90/120/180 hari) **tidak diubah**. Yang diubah hanya cara menghitung `daysOverdue`: dari cicilan tertua yang belum lunas di jadwal, bukan tebakan per bulan. |
| D3 | Bunga **fleksibel** | *Interpretasi yang dipakai (mohon dikonfirmasi):* metode hitung dipilih per produk (FLAT / ANUITAS / HARIAN yang sudah ada) dan frekuensi angsuran dipilih per produk; **rate boleh di-override per pinjaman** dalam batas produk. Cap 24%/tahun Permenkop 8/2023 **tetap berlaku** karena regulasi — override yang melewatinya ditolak. |
| D4 | Koperasi **mengelola pasar** | Modul kios/los, sewa, dan retribusi **masuk MVP** (sebelumnya P2). |

### Prinsip yang dipegang (CLAUDE.md)
- Semua query tenant data filter `tenantId` dari `req.auth.tenantId`.
- Uang = `Prisma.Decimal` end-to-end, termasuk input schema (string/`Decimal`, bukan `number`).
- Setiap baris keuangan punya `unitId`; pengelolaan pasar = unit tipe `JASA`. Tidak ada tipe
  koperasi "PASAR" dan tidak ada `if (type === ...)` baru — fitur aktif karena datanya ada.
- Respons `ApiResponse<T>`, error `ErrorCode` (kode baru ditambah ke enum).
- Tipe domain di `@siskop/types`.
- TDD; DoD: test gagal → implementasi → test lulus → lint → typecheck → commit konvensional.

---

## Fase & urutan

```
F0 Decimal di jalur pinjaman ─┐
F1 Kalender operasional ──────┼─> F2 Jadwal angsuran & KOL ─┐
                              │                              ├─> F4 Kolektor & setoran ─> F6 Mobile kolektor
                              └─> F3 Pasar, kios & pedagang ─┼─> F5 Sewa & retribusi ──────┘        │
                                                             └──────────────────────────────> F7 Laporan
```

| Fase | Isi | Ukuran | Menutup gap |
|---|---|---|---|
| F0 | Decimal di jalur pembayaran pinjaman | S | L6 |
| F1 | Kalender operasional (Minggu + hari libur tenant) | S | D1 |
| F2 | Frekuensi angsuran, jadwal angsuran, alokasi bayar, KOL dari jadwal, rate override | L | L1–L5, D2, D3 |
| F3 | Master pasar, kios/los, profil lapak pedagang | M | M1, K1 |
| F4 | Kolektor, penugasan, daftar tagih, batch setoran + rekonsiliasi | L | C1–C5 |
| F5 | Kontrak sewa, tagihan sewa & retribusi, pembayaran, jurnal | L | K2, K3 |
| F6 | Aplikasi mobile mode kolektor (online) | M | C8 |
| F7 | Laporan harian kolektor, tunggakan angsuran, tunggakan sewa/retribusi | M | C6 |

Satu PR per fase (F0 boleh digabung F2). Setiap fase bisa dirilis sendiri tanpa merusak tenant
yang tidak memakai fitur pasar.

---

## F0 — Decimal di jalur pinjaman (S)

**Masalah:** `loanPaymentSchema.amount` = `z.coerce.number()`; `recordLoanPayment` menghitung
`Math.max(0, Number(loan.remainingAmount) - data.amount)`; `splitPrincipalAndInterest` memakai
`number`.

**Perubahan**
- `modules/loans/schema.ts`: nominal (`principalAmount`, `amount`, `penalty`) divalidasi sebagai
  string desimal lalu diolah sebagai `Prisma.Decimal` — pola `updateModalDisetorSchema` di
  `modules/config/schema.ts` (regex ≤13 digit + 2 desimal, 422 alih-alih overflow 500).
- `recordLoanPayment`, `createLoan`: aritmetika pakai `Decimal`.
- `lib/journal.ts#splitPrincipalAndInterest`: versi `Decimal` (dipensiunkan di F2 untuk pinjaman
  berjadwal, tetap dipakai untuk pinjaman lama tanpa jadwal sampai backfill selesai).

**Test:** pembayaran 3× Rp33.333,33 atas total Rp100.000 → sisa tepat Rp0,01; tidak ada selisih
floating di `remainingAmount` maupun jurnal.

---

## F1 — Kalender operasional (S)

**Schema**
```prisma
model TenantHoliday {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  name      String
  createdAt DateTime @default(now())
  @@unique([tenantId, date])
}
```
Tenant: `closedWeekdays Int[] @default([0])` (0 = Minggu) — default memenuhi D1, bisa diubah
jika ada pasar yang libur di hari lain.

**Lib (pure, unit-tested):** `lib/operating-calendar.ts`
- `isOperatingDay(date, cal)`, `nextOperatingDay(date, cal)`,
  `addOperatingDays(date, n, cal)`, `operatingDaysBetween(a, b, cal)`.
- Zona waktu: tanggal operasional dihitung di `Asia/Jakarta`. Belum ada helper zona waktu di
  `lib/` (`lib/period.ts` hanya memakai waktu server), jadi F1 menambah helper `businessDate()`
  dan memakai kolom `@db.Date` agar tidak bergeser karena UTC.

**API** (`/api/config/holidays`, permission `config`): `GET` (filter tahun), `POST`, `DELETE /:id`,
`POST /import` (daftar libur nasional setahun, input JSON — tidak memanggil API eksternal).

**Frontend:** tab "Hari Libur" di halaman Config.

**Test:** isolasi tenant; tanggal duplikat ditolak; `addOperatingDays` melewati Minggu dan libur.

---

## F2 — Jadwal angsuran & KOL (L)

### Schema
```prisma
enum InstallmentFrequency { DAILY WEEKLY MONTHLY }
enum InterestMethod { FLAT ANNUITY }         // HARIAN tetap via RateType yang ada
enum InstallmentStatus { UNPAID PARTIAL PAID }

model LoanConfig {
  // + tambahan
  installmentFrequency InstallmentFrequency @default(MONTHLY)
  maxInstallments      Int?                  // pengganti maxTermMonths untuk DAILY/WEEKLY
  minRate              Decimal? @db.Decimal(8, 4)   // batas override (D3)
  maxRate              Decimal? @db.Decimal(8, 4)
}

model Loan {
  // + tambahan
  installmentFrequency InstallmentFrequency @default(MONTHLY)
  installmentCount     Int?
  installmentAmount    Decimal? @db.Decimal(15, 2)
  rate                 Decimal? @db.Decimal(8, 4)   // rate efektif pinjaman ini (snapshot)
  maturityDate         DateTime?
  installments         LoanInstallment[]
}

model LoanInstallment {
  id           String            @id @default(cuid())
  tenantId     String
  loanId       String
  loan         Loan              @relation(fields: [loanId], references: [id], onDelete: Cascade)
  seq          Int
  dueDate      DateTime          @db.Date
  principalDue Decimal           @db.Decimal(15, 2)
  interestDue  Decimal           @db.Decimal(15, 2)
  principalPaid Decimal          @default(0) @db.Decimal(15, 2)
  interestPaid  Decimal          @default(0) @db.Decimal(15, 2)
  status       InstallmentStatus @default(UNPAID)
  paidOffAt    DateTime?
  @@unique([loanId, seq])
  @@index([tenantId, dueDate, status])
}

model LoanPaymentAllocation {          // satu pembayaran bisa menutup beberapa cicilan
  id            String  @id @default(cuid())
  paymentId     String
  installmentId String
  principal     Decimal @db.Decimal(15, 2)
  interest      Decimal @db.Decimal(15, 2)
}
```
`termMonths`/`monthlyPayment` tetap diisi (pinjaman harian: `termMonths` = bulan kalender sampai
jatuh tempo, dibulatkan ke atas) agar dashboard/laporan lama tetap jalan.

### Lib (pure)
`lib/installment-schedule.ts` — `buildSchedule({ principal, rate, method, rateType, frequency,
count, disbursedAt, calendar })` → daftar `{ seq, dueDate, principalDue, interestDue }`.
- DAILY: cicilan ke-n jatuh pada hari operasional ke-n setelah pencairan (D1).
- WEEKLY: +7 hari kalender, digeser ke hari operasional berikutnya bila libur.
- MONTHLY: +1 bulan, digeser bila libur.
- FLAT: bunga total = pokok × rate × durasi; dibagi rata. HARIAN: sesuai `loan-calc.ts`
  (hari riil / 360). ANNUITY: hanya MONTHLY (DAILY/WEEKLY + ANNUITY ditolak di validasi config).
- Pembulatan: tiap cicilan dibulatkan ke rupiah (konfigurasi `roundTo`, default 1); selisih
  pembulatan dibebankan ke cicilan terakhir sehingga Σ = total persis.

### Service
- `createLoan`: input baru `installmentCount` (wajib untuk DAILY/WEEKLY) dan `rate` opsional
  (override; divalidasi `minRate ≤ rate ≤ maxRate` dan `validateRegulatoryRate`). Membuat jadwal
  dalam transaksi yang sama dengan `Loan`.
- `recordLoanPayment`: **tidak lagi menerima `dueDate`** dari klien (field diabaikan, dihapus dari
  schema setelah frontend diperbarui). Alokasi: cicilan tertua dulu, **bunga dulu lalu pokok**
  per cicilan; lebih bayar dilanjutkan ke cicilan berikutnya (percepatan). Jurnal pokok/bunga
  diambil dari alokasi, bukan rasio flat. Bayar melebihi sisa → `ErrorCode.PAYMENT_EXCEEDS_REMAINING`.
- `recalculateKOL`: `daysOverdue` = hari kalender sejak `dueDate` cicilan UNPAID/PARTIAL tertua
  yang sudah lewat; pinjaman tanpa jadwal (belum di-backfill) tetap memakai algoritma lama.
  `getKOLCategory` tidak berubah (D2).
- `GET /api/loans/:id` menyertakan `installments`; endpoint baru
  `GET /api/loans/:id/schedule` dan `POST /api/loans/configs/preview-schedule` (simulasi).

### Migrasi data
Script backfill: pinjaman ACTIVE lama → jadwal MONTHLY dari `disbursedAt`, `termMonths`,
`monthlyPayment`; pembayaran lama dialokasikan ulang ke jadwal secara berurutan. Dijalankan
sebagai data migration yang idempotent (pola `*-backfill` yang sudah ada), diuji dengan test
khusus.

### Frontend (`apps/frontend`)
- Form produk pinjaman: frekuensi, jumlah cicilan maks, rentang rate.
- Form pinjaman baru: jumlah cicilan (hari/minggu), rate override, **pratinjau jadwal**.
- Detail pinjaman: tabel jadwal (status per cicilan), form bayar tanpa `dueDate`.

### Test kunci
- 100 cicilan harian dari Sabtu → cicilan-1 hari Senin; tidak ada `dueDate` di Minggu/libur.
- Σ(principalDue) = pokok, Σ(interestDue) = total bunga, persis.
- Bayar 2,5× cicilan → 2 PAID + 1 PARTIAL; jurnal pokok/bunga = jumlah alokasi.
- Bolong 31 hari kalender → DALAM_PERHATIAN; lunasi tunggakan → LANCAR.
- Rate override di luar rentang / di atas 24% → 422.
- Pinjaman bulanan lama tetap berperilaku sama (regresi `loans.test.ts`, `kol.test.ts`).

---

## F3 — Pasar, kios & profil pedagang (M)

### Schema
```prisma
model Market {                         // satu koperasi bisa mengelola >1 pasar
  id       String @id @default(cuid())
  tenantId String
  unitId   String                      // unit JASA "Pengelola Pasar"
  name     String
  address  String?
  isActive Boolean @default(true)
  stalls   Stall[]
  @@unique([tenantId, name])
}

enum StallKind { KIOS LOS LAPAK }
enum StallStatus { AVAILABLE OCCUPIED INACTIVE }

model Stall {
  id        String      @id @default(cuid())
  tenantId  String
  marketId  String
  code      String                     // mis. "A-12"
  block     String?
  kind      StallKind
  areaM2    Decimal?    @db.Decimal(8, 2)
  status    StallStatus @default(AVAILABLE)
  @@unique([tenantId, marketId, code])
  @@index([tenantId, marketId, block])
}
```
`Member` + `commodity String?` (jenis dagangan). Lokasi pedagang diturunkan dari kontrak sewa
aktif (F5), bukan disimpan dua kali; pedagang tanpa kios (pedagang oprokan) boleh diisi
`Stall` tipe LAPAK.

**API:** `/api/market/markets`, `/api/market/stalls` (CRUD, filter pasar/blok/status). Permission
modul baru `market` (ditambah ke seed roles: Super Admin/Manager full, Teller read, Viewer read).
Membuat pasar memastikan ada unit `JASA` aktif (dibuat otomatis bila belum ada, seperti KSU).

**Frontend:** menu "Pasar" → daftar kios per pasar/blok, status terisi/kosong.

**Test:** isolasi tenant; kode kios unik per pasar; unit JASA dibuat sekali.

---

## F4 — Kolektor & setoran (L)

### Schema
```prisma
model CollectorAssignment {
  id        String @id @default(cuid())
  tenantId  String
  userId    String                     // User dengan role Kolektor
  memberId  String
  createdAt DateTime @default(now())
  @@unique([tenantId, memberId])       // satu anggota satu kolektor
  @@index([tenantId, userId])
}

enum CollectionBatchStatus { OPEN SUBMITTED VERIFIED }

model CollectionBatch {
  id            String  @id @default(cuid())
  tenantId      String
  collectorId   String
  businessDate  DateTime @db.Date
  status        CollectionBatchStatus @default(OPEN)
  expectedTotal Decimal @db.Decimal(15, 2) @default(0)   // Σ transaksi di batch
  receivedTotal Decimal? @db.Decimal(15, 2)              // diisi teller
  variance      Decimal? @db.Decimal(15, 2)              // received − expected
  submittedAt   DateTime?
  verifiedAt    DateTime?
  verifiedBy    String?
  @@unique([tenantId, collectorId, businessDate])
}
```
`SavingTransaction`, `LoanPayment`, dan `ChargePayment` (F5) + `collectionBatchId String?`.

### Akuntansi
- Akun COA baru **"Kas di Kolektor"** (aset lancar) dan **"Piutang Kolektor"** (selisih kurang),
  **"Selisih Kas"** (selisih lebih) — ditambahkan ke `coaTemplate.ts` + backfill untuk tenant
  yang sudah ada.
- Transaksi via kolektor: sisi Kas pada jurnal diganti **Kas di Kolektor** (mapping SYSTEM baru
  `MappingTransactionKind.COLLECTOR_CASH`).
- Verifikasi batch: jurnal `Dr Kas = received`, `Dr Piutang Kolektor = kurang` /
  `Cr Selisih Kas = lebih`, `Cr Kas di Kolektor = expected`. `JournalSourceType.COLLECTION_BATCH`.
  `unitId` jurnal verifikasi = null (tenant-level; batch bisa berisi transaksi beberapa unit) —
  sesuai aturan 2b.

### API (`/api/collections`, permission modul `collections`)
- `GET /today` — anggota binaan kolektor login + cicilan jatuh tempo/tertunggak + tagihan
  sewa/retribusi (setelah F5), urut pasar/blok/kode kios.
- `POST /savings-deposit`, `POST /loan-payment` — hanya untuk anggota binaan; memakai service
  yang sama dengan loket (`depositToSaving`, `recordLoanPayment`) dengan parameter `collector`.
  Batch OPEN hari ini dibuat otomatis.
- `POST /batches/:id/submit` (kolektor), `POST /batches/:id/verify` (teller, input
  `receivedTotal`), `GET /batches` (filter tanggal/kolektor/status).
- `PUT /assignments` (manager) — tetapkan/ubah kolektor anggota, massal per blok.

### Aturan
- Kolektor **tidak bisa**: menarik simpanan, bertransaksi untuk anggota non-binaan, menambah
  transaksi ke batch SUBMITTED/VERIFIED, memverifikasi batch sendiri.
- Seed role **Kolektor** (tenant baru + backfill tenant lama): `collections` create/read,
  lainnya kosong.
- Semua aksi batch masuk `AuditLog`.

### Test kunci
- Kolektor A tidak bisa menyentuh anggota binaan B (403) maupun tenant lain (404).
- Setelah verifikasi dengan kurang Rp10.000: saldo Kas di Kolektor = 0, Piutang Kolektor =
  10.000, neraca seimbang, per unit + unallocated = konsolidasi.
- Transaksi setelah submit → 409.

---

## F5 — Sewa & retribusi (L)

### Schema
```prisma
enum ChargeKind { SEWA RETRIBUSI }
enum ChargePeriod { DAILY MONTHLY YEARLY }

model StallContract {                  // pedagang menempati kios
  id          String   @id @default(cuid())
  tenantId    String
  stallId     String
  memberId    String
  startDate   DateTime @db.Date
  endDate     DateTime? @db.Date
  rentAmount  Decimal  @db.Decimal(15, 2)
  rentPeriod  ChargePeriod                 // MONTHLY | YEARLY
  isActive    Boolean  @default(true)
  @@index([tenantId, stallId, isActive])
}

model LevyRate {                       // tarif retribusi per pasar & jenis kios
  id        String    @id @default(cuid())
  tenantId  String
  marketId  String
  stallKind StallKind
  name      String                     // "Kebersihan", "Keamanan"
  amount    Decimal   @db.Decimal(15, 2)
  period    ChargePeriod @default(DAILY)
  isActive  Boolean   @default(true)
}

model Charge {                         // satu baris tagihan
  id          String     @id @default(cuid())
  tenantId    String
  unitId      String                   // unit JASA pasar
  memberId    String
  stallId     String
  kind        ChargeKind
  sourceId    String                   // contractId atau levyRateId
  periodStart DateTime   @db.Date
  dueDate     DateTime   @db.Date
  amount      Decimal    @db.Decimal(15, 2)
  paidAmount  Decimal    @default(0) @db.Decimal(15, 2)
  status      InstallmentStatus @default(UNPAID)
  @@unique([sourceId, periodStart])    // idempotensi generator
  @@index([tenantId, memberId, status])
}

model ChargePayment { id, tenantId, chargeId, amount, paidAt, createdBy, collectionBatchId? }
```

### Generator tagihan
Scheduler harian (pola `modules/scheduler`) membuat `Charge`:
- Retribusi DAILY: satu tagihan per kontrak aktif per **hari operasional** (D1 — Minggu/libur
  tidak ditagih).
- Sewa MONTHLY/YEARLY: pada tanggal periode, digeser ke hari operasional.
- Idempoten lewat `@@unique([sourceId, periodStart])`.

### Akuntansi (unit JASA pasar)
- Saat tagihan terbit: `Dr Piutang Sewa/Retribusi` / `Cr Pendapatan Sewa Kios` atau
  `Cr Pendapatan Retribusi` (akrual).
- Saat dibayar: `Dr Kas` (atau Kas di Kolektor via F4) / `Cr Piutang`.
- Akun baru di `coaTemplate.ts` dengan `unitType: "JASA"` (pola yang sama dengan akun Toko
  `unitType: "KONSUMEN"`).
- **Pertanyaan terbuka Q2:** retribusi milik koperasi atau pungutan titipan Pemda? Jika titipan,
  kreditnya ke **Utang Retribusi** (kewajiban), bukan pendapatan.

### API (`/api/market`)
Kontrak: `POST/GET /contracts`, `POST /contracts/:id/end`. Tarif: CRUD `/levy-rates`.
Tagihan: `GET /charges` (filter pasar/blok/status/pedagang), `POST /charges/:id/pay`
(loket; kolektor lewat `/api/collections/charge-payment`). Kontrak baru mengubah `Stall.status`.

### Frontend
Kontrak sewa pada detail kios & detail anggota; halaman tarif retribusi; daftar tagihan +
tunggakan; tombol bayar.

### Test kunci
Generator tidak membuat tagihan di Minggu/libur dan tidak dobel bila dijalankan dua kali;
satu kios hanya punya satu kontrak aktif; jurnal akrual & pelunasan seimbang per unit JASA;
isolasi tenant.

---

## F6 — Mobile mode kolektor (M)

`apps/mobile` (staf, role Kolektor):
- **Tagihan Hari Ini**: dikelompokkan pasar → blok; per pedagang: cicilan, tabungan harian,
  retribusi, sewa jatuh tempo; tanda sudah/belum ditagih.
- Input cepat per pedagang (satu layar, beberapa pos sekaligus), konfirmasi, bukti transaksi di
  layar.
- Ringkasan batch hari ini + tombol **Serahkan Setoran**.
- Online-only; tombol simpan dinonaktifkan saat offline dengan pesan jelas. Idempotency key per
  submit untuk mencegah dobel saat jaringan putus di tengah request (header
  `Idempotency-Key`, disimpan di tabel kecil `IdempotencyKey` bila belum ada mekanismenya).

Test: komponen (vitest + RTL, pola yang ada di `apps/mobile`), plus test backend untuk
idempotency.

---

## F7 — Laporan (M)

- **Rekap harian kolektor:** target (jatuh tempo hari ini) vs tertagih vs disetor vs selisih,
  per kolektor; ekspor.
- **Tunggakan angsuran:** per kolektor/pasar/blok, berbasis `LoanInstallment`.
- **Tunggakan sewa & retribusi:** per pasar/blok/pedagang, umur tunggakan.
- Widget dashboard: setoran hari ini, batch belum diverifikasi, total tunggakan.

---

## Cross-cutting checklist per fase
- [ ] Migration Prisma + `prisma generate`; tidak mengubah kolom lama secara destruktif.
- [ ] Tipe baru di `packages/types` (`InstallmentFrequency`, `LoanInstallment`, `Market`,
      `Stall`, `CollectionBatch`, `Charge`, ...).
- [ ] `ErrorCode` baru: `PAYMENT_EXCEEDS_REMAINING`, `RATE_OUT_OF_PRODUCT_RANGE`,
      `NOT_ASSIGNED_COLLECTOR`, `BATCH_NOT_OPEN`, `STALL_ALREADY_OCCUPIED`, `HOLIDAY_DUPLICATE`.
- [ ] Permission modul baru (`market`, `collections`) di seed roles + backfill tenant lama
      (pola `20260926012609_backfill_auditlog_role_permissions`).
- [ ] Audit log untuk semua mutasi.
- [ ] Coverage backend ≥ 80% lines; `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`.
- [ ] Update `docs/02-System-Requirements-SISKOP.md` (FR baru) dan `docs/05-DB-Schema-SISKOP.md`.

## Pertanyaan terbuka

1. **Q1 — Bunga fleksibel (D3):** apakah interpretasi di atas benar (metode & frekuensi per
   produk + override rate per pinjaman dalam rentang, tetap ≤ 24%/tahun)? Atau yang dimaksud
   rate boleh melebihi 24%?
2. **Q2 — Retribusi:** pendapatan koperasi, atau dipungut atas nama Pemda (titipan)?
3. **Q3 — Paket langganan:** modul pasar & kolektor termasuk base atau add-on berbayar (gate
   lewat `middleware/entitlement.ts` seperti modul akuntansi)?
4. **Q4 — Denda keterlambatan:** tetap manual di MVP (asumsi plan ini), atau otomatis per hari?
5. **Q5 — Pembulatan cicilan:** ke Rp1, Rp100, atau Rp500 (praktik lapangan umumnya kelipatan
   Rp500/Rp1.000 untuk tagihan harian)?
