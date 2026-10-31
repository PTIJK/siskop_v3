# Migrasi Koperasi — Pemetaan Template ke Schema SISKOP

Dokumen pendamping dua template (versi 1.1). Menjawab satu pertanyaan: **setiap kolom di template masuk ke tabel dan field mana, lewat fungsi apa, dengan transformasi apa.**

Pembaca: engineer yang membangun importer UI Platform Admin, dan platform owner yang mengaudit hasil migrasi.

| Template | Dipakai bila | Sumber data |
|---|---|---|
| `SISKOP-Template-Migrasi-Sistem.xlsx` | Koperasi punya data rinci dari sistem lama (ekspor database, buku besar, kontrak pinjaman) | Data per anggota, per pinjaman, jadwal angsuran, neraca saldo |
| `SISKOP-Template-Migrasi-Laporan.xlsx` | Koperasi hanya punya laporan (Neraca, lampiran RAT) | Angka agregat dan lampiran per anggota |

Kedua template memakai sheet 1–6 dan 10 yang sama (bagian 3.1–3.4, 3.6, 3.10). Perbedaan ada di sheet 5, 7, 8, dan 9; lihat bagian 3.11. Bila ragu, pakai template Sistem; template Laporan menghasilkan data yang kurang akurat (bagian 3.11).

- Template dibuat oleh `apps/backend/scripts/build-migration-template.ts` (menghasilkan kedua file sekaligus). Ubah template dan dokumen ini bersamaan; jalankan ulang skrip untuk menghasilkan xlsx.
- Status: **template dan pemetaan siap; importer UI belum dibangun.** Skrip `import-tenant-xlsx.ts` yang ada memuat dump mentah antar-environment (kolom = nama kolom database) dan **bukan** pembaca template ini.

---

## 1. Aturan umum pembacaan

| Aturan | Detail |
|---|---|
| Header | Baris 1 tiap sheet berisi kunci mesin (mis. `fullName`). Importer mencocokkan kolom dari baris ini, bukan dari urutan. |
| Baris diabaikan | Baris yang sel pertamanya berawalan `#` (baris petunjuk dan contoh) dan baris yang seluruh selnya kosong. |
| Nama sheet | Harus persis seperti template. Sheet opsional boleh kosong atau tidak ada. |
| Tanggal | Teks `YYYY-MM-DD`. Disimpan sebagai `DateTime` (UTC tengah malam). |
| Uang | Dibaca sebagai string lalu `Prisma.Decimal`; maksimal 2 desimal; tidak boleh `number` float (CLAUDE.md aturan 2). |
| YA/TIDAK | Dipetakan ke `Boolean`. Kosong = nilai default kolom. |
| `tenantId` | Tidak pernah ada di file. Diambil dari tenant yang baru dibuat importer (aturan 1). |
| `unitId` | Tidak ada di file. Dari kolom `unitCode` → unit hasil sheet 2; kosong = unit pertama (`getDefaultUnitId`). |
| Atomik | Seluruh impor berjalan dalam satu `db.$transaction`. Mode PRATINJAU menjalankan semuanya lalu rollback. |
| Rahasia | Kata sandi admin tidak ada di file; diisi platform owner di form eksekusi. |

## 2. Urutan eksekusi

Urutan ini wajib karena sheet belakang merujuk hasil sheet depan.

```
1_Koperasi + 2_Unit  → tenant, unit, role, COA standar        (provisionTenantInTx)
1_Koperasi (admin)   → AccountIdentity + User Super Admin     (withManagedIdentity)
10_Akun_Tambahan     → Account tambahan
4_Produk_Simpanan    → SavingConfig
6_Produk_Pinjaman    → LoanConfig
generateStandardCoaInTx → AccountMapping untuk semua produk di atas
3_Anggota            → Member + UnitMembership
5_Saldo_Simpanan     → Saving + SavingTransaction + JournalEntry
7_Pinjaman           → Loan (+ LoanInstallment) + JournalEntry
8_Jadwal_Angsuran    → LoanInstallment (menimpa jadwal buatan sistem)
9_Saldo_Awal_Jurnal  → satu JournalEntry "Saldo Awal Migrasi" (selisih saja)
                       (template Laporan: 9_Neraca, urutan sama; tanpa sheet 8)
```

---

## 3. Pemetaan per sheet

### 3.1 `1_Koperasi` → `Tenant`, `User`

Satu baris. Fungsi: `provisionTenantInTx` (`modules/tenants/provision.ts`) lalu `User` dibuat seperti `createTenant` di `modules/platform/service.ts`.

| Kolom template | Tabel.field | Transformasi / validasi |
|---|---|---|
| `name` | `Tenant.name` | wajib, min 1 karakter |
| `slug` | `Tenant.slug` (+ `TenantSlugReservation.slug`) | regex `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, maks 63; `parseSlug` menolak slug yang dicadangkan; unik |
| `registrationNo` | `Tenant.registrationNo` | wajib, unik se-platform |
| `address` | `Tenant.address` | wajib |
| `type` | `Tenant.type` | enum `TenantType`: `SYARIAH` \| `KONVENSIONAL` |
| `cooperativeType` | `Tenant.cooperativeType` | default `KSP` |
| `modalDisetor` | `Tenant.modalDisetor` | `Decimal(15,2)`, opsional; dasar batas 10% pinjaman pengurus/pengawas |
| `adminName` | `User.name` | wajib |
| `adminEmail` | `User.email` + `AccountIdentity.email` | email valid; unik per `[tenantId, email]` |
| (form eksekusi) | `User.passwordHash` | di-hash lewat jalur identitas yang sama dengan `createTenant`; min 8 karakter |
| `cutoffDate` | (konteks impor, tidak disimpan di `Tenant`) | `YYYY-MM-DD`; menjadi `entryDate` semua jurnal, `createdAt` transaksi simpanan, dan `disbursedAt` default template Laporan |

Paket langganan tidak diimpor: diatur lewat halaman Koperasi setelah migrasi (keputusan B1).

Dibuat otomatis, tidak ada di template:

| Dibuat | Sumber |
|---|---|
| `Role` × 6: Super Admin, Manager, Teller, Viewer, Kasir, Kolektor | `SEED_ROLES` di `provision.ts` |
| `User.roleId` | role "Super Admin" |
| `TenantSlugReservation` | `provisionTenantInTx` |
| `Account` COA standar | `generateStandardCoaInTx` ← `lib/coaTemplate.ts` |
| Default: `selfRegistrationEnabled=true`, `closedWeekdays=[0]`, `isActive=true` | default kolom |

### 3.2 `2_Unit` → `CooperativeUnit`

Fungsi: `provisionTenantInTx` (`firstUnit` = baris pertama, `additionalUnits` = sisanya).

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `unitCode` | (tidak disimpan) | kunci rujukan antar sheet saat impor |
| `type` | `CooperativeUnit.type` | string bebas di DB; template membatasi ke `KSP\|KONSUMEN\|PRODUSEN\|JASA\|PEMASARAN` (`CooperativeType`) |
| `name` | `CooperativeUnit.name` | wajib |

Invarian aturan 2b: minimal 1 unit. Importer menolak sheet kosong. "KSU" bukan tipe; ia hanya berarti `units.length > 1`.

### 3.3 `3_Anggota` → `Member`, `UnitMembership`

Fungsi: logika `createMember` (`modules/members/service.ts`) tanpa `withQuota` per baris; kuota `MEMBERS` diperiksa sekali untuk total baris (lihat B2).

| Kolom | Tabel.field | Transformasi / validasi |
|---|---|---|
| `legacyNo` | `AuditLog.after` (opsional) | tidak punya kolom sendiri; hanya dicatat di audit migrasi |
| `fullName` | `Member.fullName` | min 2 |
| `nik` | `Member.nik` | tepat 16 digit angka; unik per `[tenantId, nik]` (`NIK_EXISTS`) |
| `address` | `Member.address` | min 10 |
| `birthPlace` | `Member.birthPlace` | min 2 |
| `birthDate` | `Member.birthDate` | `YYYY-MM-DD` |
| `occupation` | `Member.occupation` | min 2 |
| `isPengurus` | `Member.isPengurus` | default false |
| `isPengawas` | `Member.isPengawas` | default false |
| `commodity` | `Member.commodity` | opsional |
| `isActive` | `Member.isActive` | default true |
| `unitCode` | `UnitMembership.unitId` | kosong = unit pertama |

Dibuat otomatis: `Member.memberId` = `KOP-{SLUG}-{YYYYMM}-{seq}` (`generateMemberId`; YYYYMM = **bulan migrasi**, bukan bulan daftar asli), `Member.accountNumber` = `ACC-{10 digit acak}` global unik, `UnitMembership` (satu per anggota). Karena `generateMemberId` menghitung dari DB, importer harus menomori berurutan di memori, bukan memanggilnya per baris paralel.

`Member.passwordHash` tidak diisi: portal anggota diaktifkan terpisah lewat `activatePortalAccess`.

### 3.4 `4_Produk_Simpanan` → `SavingConfig`

Fungsi: `createSavingConfig` (`modules/savings/service.ts`), termasuk `validateRegulatoryRate("SAVING", rate)` dan kuota `SAVING_TYPES`.

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `code` | (tidak disimpan) | kunci rujukan sheet 5 |
| `name` | `SavingConfig.name` | min 2 |
| `type` | `SavingConfig.type` | `POKOK\|WAJIB\|SUKARELA`; menentukan akun COA (lihat 4.1) |
| `rateType` | `SavingConfig.rateType` | `BUNGA\|BAGI_HASIL\|MARGIN` (HARIAN tidak berlaku untuk simpanan) |
| `rate` | `SavingConfig.rate` | `Decimal(8,4)`, 0–100 |
| `periodUnit` | `SavingConfig.periodUnit` | `DAILY\|MONTHLY\|YEARLY` |

Default: `isActive=true`, `isDefault=false`.

### 3.5 `5_Saldo_Simpanan` → `Saving`, `SavingTransaction`, `JournalEntry`

Fungsi: meniru `createSaving` dengan `initialDeposit = balance`.

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `nik` | `Saving.memberId` | dicari lewat `Member.nik` di tenant; tidak ketemu = error baris |
| `productCode` | `Saving.savingConfigId` | dari sheet 4 |
| `balance` | `Saving.balance`, `SavingTransaction.amount` | `Decimal(15,2)`, ≥ 0 |
| `unitCode` | `Saving.unitId` | kosong = unit pertama |

Efek per baris dengan `balance > 0`:

| Dibuat | Isi |
|---|---|
| `Saving` | `isActive=true`, `lastInterestAt=null` |
| `SavingTransaction` | `type=DEPOSIT`, `note="Saldo awal migrasi"`, `createdBy` = admin yang dibuat di 3.1 |
| `JournalEntry` + `JournalLine` | `sourceType=SAVING_TRANSACTION`, via `postSavingTransaction` (lihat 4.1), `entryDate` = tanggal cut-off |

Satu anggota boleh punya beberapa baris (satu per produk). Pasangan `[nik, productCode]` tidak boleh ganda.

`lastInterestAt=null` berarti penjadwal bunga harian akan mengkreditkan satu hari pertama saat dijalankan, bukan menumpuk mundur. Tidak perlu tindakan.

### 3.6 `6_Produk_Pinjaman` → `LoanConfig`

Fungsi: `createLoanConfig` (`modules/loans/service.ts`) + `validateRegulatoryRate("LOAN")` + `assertFrequencyMethodCompatible` + kuota `LOAN_TYPES`.

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `code` | (tidak disimpan) | kunci rujukan sheet 7 |
| `name` | `LoanConfig.name` | min 2 |
| `type` | `LoanConfig.type` | `SYARIAH\|KONVENSIONAL` |
| `rateType` | `LoanConfig.rateType` | `BUNGA\|BAGI_HASIL\|MARGIN\|HARIAN`; kombinasi dengan frekuensi divalidasi |
| `rate` | `LoanConfig.rate` | `Decimal(8,4)`, 0–100 |
| `maxTermMonths` | `LoanConfig.maxTermMonths` | int 1–360 |
| `installmentFrequency` | `LoanConfig.installmentFrequency` | `MONTHLY\|WEEKLY\|DAILY` |
| `maxInstallments` | `LoanConfig.maxInstallments` | opsional; untuk DAILY/WEEKLY |

### 3.7 `7_Pinjaman` → `Loan`, `LoanInstallment`, `JournalEntry`

**Tidak** memakai `createLoan`. `createLoan` menghitung ulang total, angsuran, dan jadwal dari plafon dan tarif produk, padahal data lama punya nilai nyata yang harus dipertahankan. Presedennya sama dengan `scripts/import-kopkar-umsurabaya.ts`: sisipkan `Loan` langsung dengan nilai yang diketahui, lalu jurnal dengan `postLoanDisbursement`.

Pemeriksaan `createLoan` yang **tetap** dijalankan: anggota ada dan punya simpanan `POKOK` aktif (`MEMBER_HAS_NO_POKOK_SAVING`). Pemeriksaan yang **diturunkan menjadi peringatan**: batas pengurus/pengawas 10% `modalDisetor` (`validateRelatedPartyLoanLimit`), peringatan pinjaman kedua (`hasExistingLoan`/`force`), batas tenor produk.

| Kolom | Tabel.field | Transformasi / validasi |
|---|---|---|
| `loanRef` | (tidak disimpan) | unik; kunci rujukan sheet 8 |
| `nik` | `Loan.memberId` | via `Member.nik` |
| `productCode` | `Loan.loanConfigId` | dari sheet 6 |
| `principalAmount` | `Loan.principalAmount` | `Decimal(15,2)` > 0 |
| `totalAmount` | `Loan.totalAmount` | ≥ `principalAmount` |
| `remainingAmount` | `Loan.remainingAmount` | 0 ≤ nilai ≤ `totalAmount` |
| `remainingPrincipal` | (tidak disimpan) → jumlah jurnal | 0 ≤ nilai ≤ `remainingAmount`; menjadi `amount` di `postLoanDisbursement` |
| `termMonths` | `Loan.termMonths` | int ≥ 1 |
| `installmentAmount` | `Loan.installmentAmount` dan `Loan.monthlyPayment` | `monthlyPayment` selalu terisi; `installmentAmount` dipakai pola F2 |
| `disbursedAt` | `Loan.disbursedAt` | tanggal; harus ≤ tanggal cut-off |
| `installmentFrequency` | `Loan.installmentFrequency` | default `MONTHLY` |
| `installmentCount` | `Loan.installmentCount` | wajib bila DAILY/WEEKLY; `null` untuk MONTHLY (sama seperti `createLoan`) |
| `rate` | `Loan.rate` | kosong = `LoanConfig.rate`; bila diisi dan berbeda dari produk, `rateNote` otomatis diisi `"Migrasi: tarif sistem lama"` agar aturan "override wajib alasan" terpenuhi |
| `status` | `Loan.status` | `ACTIVE\|COMPLETED\|DEFAULTED`; `PENDING` tidak diterima |
| `kolCategory` | `Loan.kolCategory` | default `LANCAR` |
| `daysOverdue` | `Loan.daysOverdue` | default 0 |
| `notes` | `Loan.notes` | kolom `Loan.notes` ada sejak migrasi `20261030120000_loan_notes`; **bukan** `rateNote` |
| `unitCode` | `Loan.unitId` | kosong = unit pertama |

Diturunkan oleh importer:

| Field | Aturan |
|---|---|
| `Loan.maturityDate` | jatuh tempo terakhir dari sheet 8 bila ada; bila tidak, `disbursedAt` + `termMonths` bulan |
| `LoanInstallment` (bila sheet 8 kosong untuk pinjaman ini) | jadwal sisa dibuat dengan `lib/installment-schedule.ts#buildSchedule` dari tanggal cut-off ke depan; nilai total diratakan agar jumlah pokok = `remainingPrincipal` |
| Jurnal | `postLoanDisbursement(tx, {amount: remainingPrincipal, entryDate: cutoff, description: "Saldo awal pinjaman (migrasi)"})` — hanya bila `remainingPrincipal > 0` dan status bukan `COMPLETED` |

Pinjaman `COMPLETED` dengan `remainingAmount = 0` hanya menyisipkan `Loan` tanpa jurnal.

### 3.8 `8_Jadwal_Angsuran` → `LoanInstallment`

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `loanRef` | `LoanInstallment.loanId` | dari sheet 7 |
| `seq` | `LoanInstallment.seq` | berurutan 1..n; unik per `[loanId, seq]` |
| `dueDate` | `LoanInstallment.dueDate` | `@db.Date` |
| `principalDue` | `LoanInstallment.principalDue` | Decimal |
| `interestDue` | `LoanInstallment.interestDue` | Decimal |
| `principalPaid` | `LoanInstallment.principalPaid` | default 0; ≤ `principalDue` |
| `interestPaid` | `LoanInstallment.interestPaid` | default 0; ≤ `interestDue` |
| `paidOffAt` | `LoanInstallment.paidOffAt` | opsional |

`status` diturunkan: `PAID` bila terbayar penuh, `PARTIAL` bila sebagian, selain itu `UNPAID`. Bila sheet ini mengisi sebuah pinjaman, jadwal buatan sistem untuk pinjaman itu **tidak** dibuat. Pemeriksaan silang: jumlah (`principalDue − principalPaid`) harus sama dengan `remainingPrincipal` di sheet 7; selisih = galat.

**Tidak** dibuat: `LoanPayment` dan `LoanPaymentAllocation`. Riwayat pembayaran sebelum cut-off tidak dimigrasi; hanya hasilnya (kolom `*Paid`) yang dibawa. Lihat batas cakupan di bagian 6.

### 3.9 `9_Saldo_Awal_Jurnal` → `JournalEntry`, `JournalLine`

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `accountCode` | `JournalLine.accountId` | dicari lewat `Account.code` di tenant (COA standar + sheet 10); tidak ketemu = error |
| `accountName` | (diabaikan) | hanya info |
| `debit` / `credit` | `JournalLine.debit` / `credit` | Decimal; satu sisi saja per baris |
| `unitCode` | (diabaikan, peringatan bila terisi) | jurnal selisih dihitung konsolidasi dan diposting `unitId = null` = ember "tidak dialokasikan" (aturan 2b) |

Cara kerja anti-ganda (lihat 4.2): importer **tidak** memposting sheet ini apa adanya.

1. Hitung saldo per akun dari jurnal yang sudah dibuat oleh sheet 5 dan 7 di dalam transaksi yang sama.
2. Untuk tiap akun: `selisih = saldo sheet 9 − saldo jurnal otomatis`.
3. Posting satu `JournalEntry`: `sourceType=MANUAL`, `entryType=UMUM`, `entryDate`=cut-off, `description="Saldo Awal Migrasi"`, `status=POSTED`, `createdById`=admin; satu `JournalLine` per akun dengan selisih ≠ 0 (debit bila positif untuk akun saldo-normal-debit, dst).
4. Total debit harus sama dengan total kredit (validasi sheet 9 sendiri **dan** hasil selisih). Jika tidak seimbang, impor ditolak.
5. Dibuat lewat `createJournalEntry` sehingga `entryNo` berasal dari `Tenant.journalSeq`.

### 3.10 `10_Akun_Tambahan` → `Account`

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `code` | `Account.code` | unik per `[tenantId, code]` |
| `name` | `Account.name` | wajib |
| `category` | `Account.category` | enum `AccountCategory` |
| `normalBalance` | `Account.normalBalance` | enum `NormalBalance` |
| `parentCode` | `Account.parentId` | dicari lewat `code` |
| `isCashEquivalent` | `Account.isCashEquivalent` | default false |

`isDefault=false`, `isActive=true`, `equityClass=null`. Akun EKUITAS tambahan tanpa `equityClass` **tidak dihitung** dalam Modal Sendiri (`MODAL_SENDIRI_CLASSES`); importer memberi peringatan. Lihat butir terbuka B4.

---

### 3.11 Template Laporan — perbedaan dari template Sistem

Dipakai bila sumbernya laporan. Yang berbeda dari bagian 3.1–3.10:

| Sheet | Sistem | Laporan |
|---|---|---|
| 3_Anggota | identik | **identik; identitas lengkap tetap wajib** (lihat B9) |
| 5_Saldo_Simpanan | identik | identik; sumbernya lampiran simpanan RAT, total harus sama dengan akun simpanan di Neraca |
| 7_Pinjaman | rinci (3.7) | **ringkas** (3.11.1) |
| 8_Jadwal_Angsuran | ada | **tidak ada**; jadwal selalu dibuat sistem |
| 9 | `9_Saldo_Awal_Jurnal` (neraca saldo debit/kredit) | **`9_Neraca`** (3.11.2) |

#### 3.11.1 `7_Pinjaman` (ringkas) → `Loan`, `LoanInstallment`, `JournalEntry`

Sama seperti 3.7: tidak memakai `createLoan`, `Loan` disisipkan langsung lalu dijurnal dengan `postLoanDisbursement`. Bedanya, laporan tidak memuat plafon, tenor, atau tanggal cair, sehingga importer **membuat nilai pengganti** dan menandainya.

| Kolom template | Tabel.field | Nilai |
|---|---|---|
| `loanRef` | (tidak disimpan) | unik |
| `nik` | `Loan.memberId` | via `Member.nik` |
| `productCode` | `Loan.loanConfigId` | dari sheet 6 |
| `remainingPrincipal` | jumlah jurnal | wajib; > 0 |
| `remainingAmount` | `Loan.remainingAmount` | kosong → `remainingPrincipal` |
| `termMonths` | `Loan.termMonths` | perkiraan **sisa** tenor, int ≥ 1 |
| `installmentAmount` | `Loan.installmentAmount`, `Loan.monthlyPayment` | kosong → `remainingAmount ÷ termMonths` (pembulatan ke 2 desimal; selisih pembulatan ke angsuran terakhir) |
| `kolCategory` | `Loan.kolCategory` | default `LANCAR` |
| `notes` | `Loan.notes` | importer menambah awalan `Migrasi dari laporan RAT: tenor dan tanggal cair estimasi.` di depan isi admin |
| `unitCode` | `Loan.unitId` | kosong = unit pertama |

Nilai pengganti yang dibuat importer (tidak ada di file):

| Field | Nilai |
|---|---|
| `Loan.principalAmount` | = `remainingAmount` (plafon asli tidak diketahui) |
| `Loan.totalAmount` | = `remainingAmount` |
| `Loan.disbursedAt` | = tanggal cut-off (bukan tanggal cair asli) |
| `Loan.status` | `ACTIVE` |
| `Loan.daysOverdue` | 0 |
| `Loan.installmentFrequency` | `MONTHLY`, `installmentCount=null` |
| `Loan.rate` | `LoanConfig.rate`, tanpa `rateNote` (bukan override) |
| `LoanInstallment` × `termMonths` | `seq` 1..n, jatuh tempo = tanggal cut-off + n bulan (digeser kalender operasional bila perlu), `principalDue` dibagi rata dari `remainingPrincipal`, `interestDue` = `remainingAmount − remainingPrincipal` dibagi rata, `*Paid=0`, `status=UNPAID` |
| `Loan.maturityDate` | jatuh tempo angsuran terakhir |

Konsekuensi yang harus diketahui pengguna: umur tunggakan, KOL, dan laporan jatuh tempo akurat hanya setelah kontrak asli dimasukkan. Pinjaman macet yang diketahui dari laporan diisi manual di `kolCategory`. Pinjaman yang sudah lunas tidak dimasukkan (laporan tidak memuatnya).

#### 3.11.2 `9_Neraca` → `JournalEntry`, `JournalLine`

Menggantikan `9_Saldo_Awal_Jurnal`. Admin menyalin baris Neraca; importer yang menentukan debit/kredit.

| Kolom | Tabel.field | Catatan |
|---|---|---|
| `reportName` | `AuditLog.after` | nama akun persis di laporan; jejak audit, tidak masuk jurnal |
| `accountCode` | `JournalLine.accountId` | via `Account.code` di tenant (COA standar + sheet 10); wajib |
| `amount` | `JournalLine.debit` atau `credit` | lihat aturan tanda di bawah |
| `unitCode` | `JournalEntry.unitId` | kosong = `null` (aturan 2b). Neraca laporan konsolidasi |

Aturan tanda: `amount` positif berarti **sesuai saldo normal akun SISKOP** (`Account.normalBalance`); negatif berarti berlawanan.

| `normalBalance` akun | `amount` > 0 | `amount` < 0 |
|---|---|---|
| `DEBIT` (Aset, Beban) | debit | kredit sebesar `|amount|` |
| `KREDIT` (Kewajiban, Ekuitas, Pendapatan) | kredit | debit sebesar `|amount|` |

Akun kontra seperti `1-1190` Penyisihan Kerugian Piutang sudah bersaldo normal `KREDIT`, jadi admin menulisnya **positif** (angka di Neraca biasanya tampil sebagai pengurang, tertulis positif atau dalam kurung). Negatif hanya untuk kasus berlawanan, mis. rugi tahun berjalan pada akun SHU. Beberapa baris Neraca boleh menuju satu `accountCode`; importer menjumlahkannya per akun sebelum menghitung selisih.

Setelah itu alurnya sama dengan 3.9: hitung selisih terhadap jurnal otomatis sheet 5 dan 7, posting satu jurnal `MANUAL` "Saldo Awal Migrasi" untuk selisihnya.

Validasi khusus: jumlah debit hasil konversi = jumlah kredit. Dengan Neraca yang benar ini setara dengan Aset = Kewajiban + Ekuitas. Pratinjau menampilkan ketiga subtotal agar admin bisa mencocokkan dengan Neraca laporan.

Batasan: Neraca tidak memuat pendapatan dan beban rinci. Cut-off di akhir tahun buku yang sudah ditutup membuat saldo laba rugi nol (laba sudah menjadi SHU di ekuitas). Cut-off tengah tahun hanya membawa satu angka SHU Tahun Berjalan (`3-3000`), sehingga Laba Rugi dan Arus Kas tahun berjalan baru benar sejak cut-off.

### 3.12 Koperasi tujuan yang sudah terdaftar

Selain membuat koperasi baru dari sheet 1, platform admin dapat memilih koperasi yang sudah terdaftar lewat dropdown pencarian (nama, subdomain, atau no. badan hukum). Pilihan ini ada di langkah **Pratinjau**, bukan di langkah unggah: pratinjau pertama selalu untuk koperasi baru, dan mengganti tujuan menjalankan pratinjau ulang dengan `tenantId`. Dikirim sebagai field `tenantId` pada `POST /api/platform/migration/preview` dan `/execute`.

| Aspek | Koperasi baru | Koperasi yang sudah terdaftar |
|---|---|---|
| `Tenant`, `Role` x6, COA standar, `User` admin | dibuat (3.1) | **tidak dibuat**; dipakai yang sudah ada |
| Sheet 1 | seluruh kolom dipakai | hanya `cutoffDate` dan `modalDisetor` (bila diisi) yang dipakai; `slug` harus sama dengan tujuan; `name` berbeda = peringatan; data admin diabaikan (peringatan) |
| Kata sandi admin | wajib (min. 8) | tidak diminta |
| `CooperativeUnit` (sheet 2) | dibuat; unit pertama = default | unit dengan tipe dan nama sama dipakai ulang; yang belum ada ditambahkan; urutan unit tujuan tidak diubah |
| `createdBy` baris simpanan dan jurnal | admin baru | Super Admin aktif tertua milik koperasi tujuan |
| Akun tambahan (sheet 10) | dibuat | kode yang sudah ada di tujuan = kesalahan |
| Audit `tenant.migrate` | tenant baru | koperasi tujuan |

Syarat koperasi tujuan (kesalahan bila tidak terpenuhi): ada; punya Super Admin aktif; **tidak punya anggota, rekening simpanan, pinjaman, atau jurnal**; `slug` di file sama. Bila sudah punya produk simpanan/pinjaman, itu peringatan dan produk dari file ditambahkan. Koperasi yang sudah berisi data tidak didukung (butir terbuka B12).

---

## 4. Alur akun (ke mana uang pergi)

### 4.1 Pemetaan akun otomatis

Jurnal simpanan dan pinjaman memakai `AccountMapping` per produk. Importer menjalankan `generateStandardCoaInTx` **setelah** sheet 4 dan 6 dibuat; fungsi ini idempoten dan membuat pemetaan berikut untuk setiap produk:

| Produk | Transaksi | Debit | Kredit |
|---|---|---|---|
| Simpanan `POKOK` | DEPOSIT | `1-1000` Kas | `3-1000` Simpanan Pokok |
| Simpanan `WAJIB` | DEPOSIT | `1-1000` Kas | `3-1100` Simpanan Wajib |
| Simpanan `SUKARELA` | DEPOSIT | `1-1000` Kas | `2-1000` Simpanan Sukarela — Anggota |
| Pinjaman | DISBURSEMENT | `1-1100` Piutang Pinjaman Anggota | `1-1000` Kas |
| Pinjaman | PAYMENT_PRINCIPAL | `1-1000` Kas | `1-1100` |
| Pinjaman | PAYMENT_INTEREST | `1-1000` Kas | `4-1000` Pendapatan Bunga/Margin |
| Pinjaman | PAYMENT_PENALTY | `1-1000` Kas | `4-9000` Pendapatan Lain-lain |

Tanpa pemetaan, jurnal berstatus `UNPOSTED_MISSING_MAPPING` dan laporan kosong. Bila koperasi ingin akun berbeda (mis. Kas di bank `1-1010`), platform owner mengubah pemetaan di Konfigurasi **sebelum** menjalankan eksekusi, atau importer menerima override (butir terbuka B3).

### 4.2 Efek ke Kas dan rekonsiliasi

Karena pemetaan menggunakan Kas sebagai lawan, jurnal otomatis menggeser Kas: bertambah sebesar total saldo simpanan, berkurang sebesar total sisa pokok. Itu hanya perantara. Jurnal "Saldo Awal Migrasi" (3.9) mengoreksi setiap akun ke angka neraca saldo sistem lama, sehingga saldo akhir Kas sama dengan sheet 9. Admin cukup mengisi neraca saldo asli.

Pemeriksaan rekonsiliasi buku pembantu saat pratinjau (peringatan, bukan penolakan):

| Pemeriksaan | Dibandingkan |
|---|---|
| Simpanan Pokok | Σ sheet 5 tipe POKOK vs saldo `3-1000` sheet 9 |
| Simpanan Wajib | Σ sheet 5 tipe WAJIB vs `3-1100` |
| Simpanan Sukarela | Σ sheet 5 tipe SUKARELA vs `2-1000` |
| Piutang | Σ `remainingPrincipal` sheet 7 vs `1-1100` |

### 4.3 Rantai satu baris sheet 5

```
5_Saldo_Simpanan (nik, productCode, balance)
  → Member (cari lewat nik)  +  SavingConfig (cari lewat productCode)
  → Saving { unitId, memberId, savingConfigId, balance }
  → SavingTransaction { type: DEPOSIT, amount }
  → postSavingTransaction → buildComponentLines
        ← AccountMapping(SAVING_CONFIG, savingConfigId, DEPOSIT)
  → JournalEntry { sourceType: SAVING_TRANSACTION, unitId }
  → JournalLine × 2 { Kas debit, Simpanan kredit }
```

---

## 5. Validasi pratinjau

Setiap galat dilaporkan sebagai `{sheet, baris, kolom, pesan}`. Pratinjau tidak menyimpan apa pun.

| Kelas | Contoh | Hasil |
|---|---|---|
| Struktur | sheet wajib hilang, kolom wajib tidak ada di header | galat, berhenti |
| Format | NIK bukan 16 digit, tanggal bukan `YYYY-MM-DD`, uang >2 desimal | galat |
| Rujukan | `nik` tidak ada di sheet 3, `productCode` tidak ada, `unitCode` tidak ada, `accountCode` tidak ada | galat |
| Keunikan | NIK ganda, `slug`/`registrationNo`/`adminEmail` sudah dipakai, `[nik, productCode]` ganda, `loanRef` ganda | galat |
| Aturan bisnis | pinjaman tanpa simpanan pokok, sheet 9 tidak seimbang, jadwal vs `remainingPrincipal` berbeda | galat |
| Rekonsiliasi | buku pembantu vs sheet 9 (4.2), pelanggaran batas pengurus 10%, akun EKUITAS tanpa `equityClass` | peringatan |
| Kuota | jumlah anggota/produk melebihi paket | galat (`assertQuota`, lihat B2) |
| Khusus Laporan | `9_Neraca` tidak seimbang; baris Neraca tanpa `accountCode`; `7_Pinjaman` tanpa `termMonths`; sheet 8 ada di file Laporan | galat (sheet 8 di file Laporan: diabaikan dengan peringatan) |
| Khusus Laporan | Σ sheet 5 per tipe simpanan ≠ akun simpanan di Neraca; Σ `remainingPrincipal` ≠ akun Piutang | peringatan (sama dengan bagian 4.2, sumber pembanding adalah Neraca) |

Importer mengenali jenis template dari nama sheet 9: `9_Saldo_Awal_Jurnal` = Sistem, `9_Neraca` = Laporan. File dengan keduanya, atau tanpa keduanya, ditolak.

Ringkasan yang ditampilkan: jumlah baris per sheet, Σ simpanan per tipe, Σ sisa pokok, Σ debit/kredit sheet 9, jumlah peringatan.

---

## 6. Yang sengaja tidak dimigrasi

| Data | Alasan / jalur pengganti |
|---|---|
| Riwayat transaksi simpanan sebelum cut-off | hanya saldo; satu `DEPOSIT` "Saldo awal migrasi" per rekening |
| Riwayat pembayaran angsuran (`LoanPayment`) | hanya hasilnya di `LoanInstallment.*Paid` |
| Foto KTP (`ktpPhotoUrl`), kata sandi portal anggota | diunggah / diaktifkan terpisah |
| `Product`, `POSSale`, `StockMovement` (Toko) | di luar cakupan versi 1.0 |
| `Market`, `Stall`, `StallContract`, `Charge` (pasar) | di luar cakupan versi 1.0 |
| Pengguna staf selain admin pertama | dibuat lewat menu Pengguna setelah migrasi |
| `SavingConfig`/`LoanConfig` tidak aktif | tidak dibawa |
| Invoice, pembayaran langganan | berasal dari alur billing platform |

---

## 7. Butir terbuka (perlu keputusan sebelum importer dibangun)

| # | Pertanyaan | Dampak |
|---|---|---|
| B1 | **Diputuskan:** paket tidak diimpor; diatur lewat halaman Koperasi setelah migrasi (kolom `package` dihapus dari template). | - |
| B2 | `withQuota`/`assertQuota` per baris atau sekali untuk total? Bila paket belum menampung jumlah anggota, apakah migrasi ditolak atau paket dinaikkan dulu? Usulan: periksa total di pratinjau, tolak bila melebihi. | Migrasi gagal di tengah |
| B3 | Boleh override akun pemetaan per produk (Kas → Bank `1-1010`)? Usulan versi 1.0: tidak; ubah di Konfigurasi sebelum eksekusi. | Fleksibilitas vs kompleksitas |
| B4 | Akun EKUITAS tambahan (sheet 10) tanpa `equityClass`: tambahkan kolom `equityClass`? Tanpanya Modal Sendiri dan Neraca bisa meleset. Usulan: tambah kolom di versi 1.1. | Laporan regulasi |
| B5 | `Member.memberId` memakai bulan migrasi. Perlu mempertahankan nomor anggota lama? Butuh kolom baru di `Member` (tidak ada hari ini); `legacyNo` kini hanya masuk audit log. | Anggota mengenali nomor lamanya |
| B6 | Pinjaman `DEFAULTED`/`MACET`: apakah perlu memetakan ke `1-1190` Penyisihan Kerugian Piutang? Presedennya kopkar memakai akun Piutang Macet khusus. Template saat ini menyerahkannya ke sheet 9. | Neraca kualitas aset |
| B7 | Tempat mendokumentasikan hasil migrasi: usulan menyimpan hash file, jumlah baris, dan ringkasan pratinjau di `AuditLog` dengan `action="tenant.migrate"`. | Jejak audit |
| B8 | **Sebagian selesai.** Anggota dan nomor rekening sudah dibuat massal (`createManyAndReturn`, penomoran di memori). Simpanan dan pinjaman masih dijurnal per baris lewat `postSavingTransaction`/`postLoanDisbursement`. Terukur (DB uji lokal, 2026-10-31): 5.000 anggota + 5.000 rekening + 1.500 pinjaman = 166 detik pratinjau, 154 detik eksekusi (~25 ms/baris). Opsi: (a) jurnal massal (satu `journalSeq` increment, `createManyAndReturn` entri, `createMany` baris, pemetaan akun dihitung sekali per produk), (b) job asinkron. | Request sinkron melewati batas waktu proxy untuk koperasi besar |
| B9 | Template Laporan tetap mewajibkan identitas anggota lengkap (NIK 16 digit, alamat, tempat/tanggal lahir, pekerjaan) karena `Member` mewajibkannya dan NIK dipakai login portal. Tidak ada placeholder. Alternatif bila koperasi benar-benar tidak punya: ubah schema agar identitas boleh kosong dengan penanda "belum lengkap". **Belum diputuskan; saat ini roster lengkap adalah syarat mutlak.** | Koperasi tanpa buku anggota tidak bisa migrasi |
| B10 | Nilai pengganti pinjaman template Laporan (3.11.1): `disbursedAt` = cut-off dan tenor perkiraan admin. Apakah perlu bendera di `Loan` (mis. `isEstimated`) agar laporan dan daftar bisa menyaring pinjaman estimasi? Saat ini hanya ditandai di `notes`. | Pinjaman estimasi tidak bisa difilter |
| B11 | Template Laporan: apakah sheet 9 boleh menerima laba rugi tahun berjalan terpisah untuk cut-off tengah tahun? Saat ini hanya angka SHU Tahun Berjalan. | Laporan tahun berjalan |
| B12 | Migrasi ke koperasi yang sudah berisi data (menambah anggota dan saldo) belum didukung: perlu aturan bentrok NIK, kode produk, dan jurnal saldo awal ganda. | Hanya koperasi kosong yang bisa menjadi tujuan |

## 8. Pengujian yang disarankan (TDD, aturan 4)

1. Template round-trip: baca kedua xlsx hasil `build-migration-template.ts` dengan baris contoh dibuang → nol baris data, nol galat, dan jenis template terdeteksi benar (Sistem/Laporan).
1a. Template Laporan: Neraca kecil (Kas, Piutang, Penyisihan, Simpanan Pokok/Wajib/Sukarela, Cadangan, SHU) → jurnal "Saldo Awal Migrasi" seimbang; akun kontra `1-1190` ditulis positif menjadi kredit; baris negatif berbalik sisi; pinjaman ringkas menghasilkan jadwal sebanyak `termMonths` dengan Σ pokok = `remainingPrincipal`.
2. Fixture kecil (2 unit, 3 anggota, 2 produk simpanan, 1 pinjaman) → pratinjau bersih; eksekusi → Σ debit = Σ kredit dan `Neraca` per cut-off sama dengan sheet 9.
3. Anti-ganda: sheet 9 memuat Simpanan Pokok yang sama dengan sheet 5 → jurnal "Saldo Awal Migrasi" tidak memuat akun itu.
4. Setiap kelas galat di bagian 5 menghasilkan galat berbaris-kolom yang benar.
5. Isolasi tenant: dua impor berurutan tidak saling melihat anggota/akun (aturan 1).
