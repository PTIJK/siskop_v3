# Design Spec — Konfigurasi Akun (Accounting Configuration / Chart of Accounts)
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Modul** | Tenant — Sistem Konfigurasi (Konfigurasi Akun) |
| **Tanggal** | 21 Juli 2026 |
| **Status** | Draft — for panel review |
| **Terkait** | 01-PRD-SISKOP.md §8 (Out of Scope — fitur akuntansi lengkap), §6.7 (Modul Sistem Konfigurasi), 03-ERD-SISKOP.md §2.7 (SavingConfig), §2.10 (LoanConfig), `Docs/specs/2026-07-21-paket-langganan-design.md` (module entitlement pattern) |

---

## 1. Background & Problem

SISKOP currently records savings and loan activity (`SavingTransaction`, `LoanPayment`) but has no chart of accounts and no concept of which general-ledger account a transaction affects. PRD §7.6 lists laporan keuangan (RPT-01/RPT-07) as a requirement, but PRD §8 explicitly puts "fitur akuntansi lengkap (jurnal, neraca, buku besar)" out of scope for v1.0 — today's financial report is a hand-aggregated summary of savings/loan totals, not a true accounting output.

Indonesian regulation has moved since the PRD was last scoped: **Permenkop UKM No. 2/2024** requires koperasi to prepare financial statements using the SAK (Standar Akuntansi Keuangan) issued by IAI — currently **SAK EP** (Standar Akuntansi Keuangan Entitas Privat, effective for periods beginning on/after 1 Jan 2025). The old koperasi-specific standard, PSAK 27, has been revoked. This raises the bar on what "laporan keuangan" needs to mean for tenants operating after that effective date, and makes a real Chart of Accounts (COA) a prerequisite rather than a nice-to-have.

This spec proposes a bounded first phase: a **Konfigurasi Akun (Accounting Configuration)** module that lets each tenant define a COA following standard accounting numbering, and map its existing transaction types (savings deposits/withdrawals, loan disbursement/payments) to accounts. It deliberately does **not** build a journal/posting engine or auto-generated Neraca/Laporan Hasil Usaha — that remains a later phase (§10).

## 2. Panel Discussion

**Product (scope & sequencing)**
PRD §8 was explicit that full accounting is out of scope for v1.0, and that decision shouldn't get silently reopened. The proposal on the table is narrower than "full accounting": configuration + mapping only, not journal posting. That's a defensible v1.1-sized slice. Open question: should this be a separately gated, sellable module (like whitelabel), or bundled free into System Config for every tenant? Recommendation — gate it, since it's meaningfully more complex to support than existing config screens and not every small koperasi needs it yet.

**Accounting / Compliance SME**
Two things the generic "1000/2000/3000..." COA advice gets wrong for a koperasi specifically:

1. **Simpanan Pokok and Simpanan Wajib are conventionally booked as EQUITY (modal anggota)**, not liabilities — they're non-withdrawable while the member is active and represent an ownership stake. **Simpanan Sukarela is a LIABILITY** — a deposit the koperasi owes back to the member on demand. SISKOP's existing `SavingConfig.type` enum (`POKOK` / `WAJIB` / `SUKARELA`) carries no accounting classification today, and it shouldn't be hardcoded into application logic either — some koperasi treat Wajib differently in practice. This has to be a mapping the tenant configures, defaulted sensibly.
2. The expected financial statement set for a koperasi under SAK EP is: **Neraca** (balance sheet), **Laporan Perhitungan Hasil Usaha** (income statement — computes SHU/Sisa Hasil Usaha), **Laporan Arus Kas** (cash flow), **Laporan Promosi Ekonomi Anggota** (member economic benefit report — cooperative-specific, not part of any generic COA guide), and **Catatan Atas Laporan Keuangan** (notes). This spec doesn't need to produce all of these now — it only needs the COA's categories and mappings to be *capable* of feeding them later.

**Backend Engineer**
Three implementation concerns:
- Accounts should be **hierarchical** (header/group accounts vs. postable detail accounts) from day one. Retrofitting a parent-child tree onto a flat table later is painful; the UI can still default to a flat list view even if the schema supports nesting.
- Same tenant-isolation pattern as everything else in the ERD (§5): `Account` and `AccountMapping` both need `tenantId` + indexes, no exceptions.
- Account codes need to be validated against the category-prefix convention (`1-` for Aset, `2-` for Kewajiban, etc.) at write time — otherwise nothing downstream can reliably aggregate by category from the code alone, which defeats the point of standard COA naming.
- Mapping a `SavingConfig`/`LoanConfig` transaction type to an account should **not** be mandatory at the moment a savings or loan config is created — that would block existing SAV-01/LOAN-01 flows for tenants who haven't touched accounting yet. Mapping completeness should be a separate, trackable state.

**Frontend/UX**
Wants a one-click "seed COA standar" action using the default template (§4), the same pattern already used for the 3 default Simpanan types (ERD §2.7, SAV-08) — tenant admins shouldn't have to build a chart of accounts from a blank screen. Also wants a completeness indicator (mirroring the quota indicator pattern from `paket-langganan-design.md` §8) — something like "3 dari 6 jenis transaksi belum dipetakan ke akun" — so admins can tell the module is configured-but-incomplete rather than silently wrong.

**Resolved by group**
- Scope is COA configuration + account mapping only. Journal/ledger posting and auto-generated financial statements are separate, later specs (§10 — consistent with PRD §8, not reopening it).
- Gate behind the existing package/module entitlement mechanism (`SubscriptionPackage.modules[]`), module key `"accounting"`.
- Accounts are hierarchical (self-referencing parent), category-prefixed codes, standard template seedable on demand.
- The equity-vs-liability treatment of each Simpanan type is a mapping the tenant sets (via `AccountMapping`), not hardcoded logic. The seeded default template pre-maps Pokok/Wajib → Ekuitas and Sukarela → Kewajiban as the conventional default; tenant admins can remap.

## 3. Resolved Decisions

| Question | Decision |
|---|---|
| Full journal/ledger engine in this spec? | No. COA config + account mapping only. Posting engine is a later spec. |
| Is this module gated by subscription package? | Yes — new module key `"accounting"` in `SubscriptionPackage.modules[]`, same pattern as existing module gating (ADM-05). |
| Flat or hierarchical accounts? | Hierarchical (`parentId` self-relation), with a `isHeader` flag distinguishing non-postable group accounts from postable detail accounts. |
| Is Simpanan Pokok/Wajib equity or liability? | Configurable via mapping, not hardcoded. Default template maps Pokok/Wajib → Ekuitas, Sukarela → Kewajiban (conventional koperasi treatment). |
| Must every SavingConfig/LoanConfig be mapped before it can be used? | No. Mapping is independent of transacting — existing SAV/LOAN flows are unaffected if accounting isn't configured. Completeness is surfaced as a UI indicator, not enforced as a hard gate (v1 of this module). |
| Can a tenant delete/rename standard seeded accounts? | Deletion blocked for `isDefault=true` accounts and any account referenced by an `AccountMapping` (`409 ACCOUNT_IN_USE`). Renaming the label is allowed; the code is fixed once created to avoid breaking category-prefix aggregation. |
| Does this replace today's RPT-01 financial report? | No, not in this spec. RPT-01 keeps working as-is (savings/loan aggregate summary). Full ledger-driven Neraca/Laporan Hasil Usaha is Phase 2/3 (§10). |

## 4. Standar COA — Numbering Convention

Category-prefixed codes, consistent with standard Indonesian COA practice and aligned to SAK EP account classification for a koperasi simpan pinjam:

| Prefix | Kategori | Saldo Normal |
|---|---|---|
| `1-xxxx` | ASET (Aset Lancar, Aset Tetap) | Debit |
| `2-xxxx` | KEWAJIBAN (termasuk Simpanan Sukarela) | Kredit |
| `3-xxxx` | EKUITAS (termasuk Simpanan Pokok & Wajib, SHU) | Kredit |
| `4-xxxx` | PENDAPATAN | Kredit |
| `5-xxxx` | BEBAN | Debit |

**Default template (seeded on request, editable after seeding):**

| Kode | Nama Akun | Kategori | Catatan |
|---|---|---|---|
| 1-1000 | Kas | Aset | |
| 1-1010 | Bank | Aset | |
| 1-1100 | Piutang Pinjaman Anggota | Aset | Saldo pokok pinjaman berjalan |
| 1-1190 | Penyisihan Kerugian Piutang | Aset (contra) | CKPN — kredit-normal, mengurangi piutang |
| 1-2000 | Aset Tetap | Aset | Header/group account |
| 2-1000 | Simpanan Sukarela — Anggota | Kewajiban | Dana anggota, dapat ditarik |
| 2-1100 | Utang Usaha | Kewajiban | |
| 3-1000 | Simpanan Pokok | Ekuitas | Non-withdrawable selama anggota aktif |
| 3-1100 | Simpanan Wajib | Ekuitas | Non-withdrawable selama anggota aktif |
| 3-2000 | Cadangan / Modal Penyertaan | Ekuitas | |
| 3-3000 | SHU Tahun Berjalan | Ekuitas | |
| 3-3100 | SHU Tahun Lalu Belum Dibagi | Ekuitas | |
| 4-1000 | Pendapatan Bunga/Margin Pinjaman | Pendapatan | Per jenis pembiayaan via mapping |
| 4-2000 | Pendapatan Jasa Administrasi | Pendapatan | |
| 4-9000 | Pendapatan Lain-lain | Pendapatan | |
| 5-1000 | Beban Bunga/Bagi Hasil Simpanan | Beban | |
| 5-2000 | Beban Operasional — Gaji | Beban | |
| 5-2100 | Beban Sewa | Beban | |
| 5-3000 | Beban Penyisihan Kerugian Piutang | Beban | |
| 5-9000 | Beban Lain-lain | Beban | |

Tenants may add, rename (label only), or deactivate non-default accounts, and must add new codes within their category's prefix range — enforced server-side (§8).

## 5. Data Model

### 5.1 `Account` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `tenantId` | String, FK | Tenant isolation |
| `code` | String | e.g. `1-1000`; unique per tenant |
| `name` | String | e.g. "Kas" |
| `category` | Enum `AccountCategory` | `ASET \| KEWAJIBAN \| EKUITAS \| PENDAPATAN \| BEBAN` |
| `normalBalance` | Enum `NormalBalance` | `DEBIT \| KREDIT`, derived from category but stored for query convenience |
| `parentId` | String, nullable, self-FK | Header/group hierarchy |
| `isHeader` | Boolean, default false | `true` = non-postable group account |
| `isDefault` | Boolean, default false | `true` for accounts from the seeded standard template; protected from deletion |
| `isActive` | Boolean, default true | Soft-deactivate instead of delete |
| `createdAt` / `updatedAt` | DateTime | Standard audit columns |

**Unique constraint:** `(tenantId, code)` · **Index:** `tenantId`, `category`, `parentId`

### 5.2 `AccountMapping` (new)

Maps a transaction-producing source (a specific `SavingConfig`, a specific `LoanConfig`, or a tenant-wide system default) to the debit/credit accounts it should eventually post to.

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `tenantId` | String, FK | Tenant isolation |
| `sourceType` | Enum `MappingSourceType` | `SAVING_CONFIG \| LOAN_CONFIG \| SYSTEM` |
| `sourceId` | String, nullable | FK to `SavingConfig.id` or `LoanConfig.id` when scoped; `null` for `SYSTEM` (e.g. default Kas/Bank) |
| `transactionKind` | Enum `MappingTransactionKind` | `DEPOSIT \| WITHDRAWAL \| DISBURSEMENT \| PAYMENT_PRINCIPAL \| PAYMENT_INTEREST \| PAYMENT_PENALTY` |
| `debitAccountId` | String, FK → Account | |
| `creditAccountId` | String, FK → Account | |
| `createdAt` / `updatedAt` | DateTime | |

**Unique constraint:** `(tenantId, sourceType, sourceId, transactionKind)` · **Index:** `tenantId`

Prisma sketch:

```prisma
enum AccountCategory {
  ASET
  KEWAJIBAN
  EKUITAS
  PENDAPATAN
  BEBAN
}

enum NormalBalance {
  DEBIT
  KREDIT
}

enum MappingSourceType {
  SAVING_CONFIG
  LOAN_CONFIG
  SYSTEM
}

enum MappingTransactionKind {
  DEPOSIT
  WITHDRAWAL
  DISBURSEMENT
  PAYMENT_PRINCIPAL
  PAYMENT_INTEREST
  PAYMENT_PENALTY
}

model Account {
  id            String          @id @default(cuid())
  tenantId      String
  tenant        Tenant          @relation(fields: [tenantId], references: [id])
  code          String
  name          String
  category      AccountCategory
  normalBalance NormalBalance
  parentId      String?
  parent        Account?        @relation("AccountHierarchy", fields: [parentId], references: [id])
  children      Account[]       @relation("AccountHierarchy")
  isHeader      Boolean         @default(false)
  isDefault     Boolean         @default(false)
  isActive      Boolean         @default(true)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  debitMappings  AccountMapping[] @relation("DebitAccount")
  creditMappings AccountMapping[] @relation("CreditAccount")

  @@unique([tenantId, code])
  @@index([tenantId])
  @@index([category])
}

model AccountMapping {
  id              String                  @id @default(cuid())
  tenantId        String
  tenant          Tenant                  @relation(fields: [tenantId], references: [id])
  sourceType      MappingSourceType
  sourceId        String?
  transactionKind MappingTransactionKind
  debitAccountId  String
  debitAccount    Account                 @relation("DebitAccount", fields: [debitAccountId], references: [id])
  creditAccountId String
  creditAccount   Account                 @relation("CreditAccount", fields: [creditAccountId], references: [id])
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  @@unique([tenantId, sourceType, sourceId, transactionKind])
  @@index([tenantId])
}
```

## 6. API Endpoints (new)

Follows existing response envelope and route namespacing conventions (`Docs/api-conventions.md`) — tenant-scoped, no `/api/tenant/` prefix.

```
GET    /api/config/accounts?category=&page=&limit=&search=      List accounts (paginated, filterable by category)
POST   /api/config/accounts                                     Create account
PUT    /api/config/accounts/:id                                 Update account (name/isActive; code immutable after creation)
DELETE /api/config/accounts/:id                                 Deactivate account (soft delete)
POST   /api/config/accounts/seed-default                        Seed the standard COA template (§4) — no-op/blocked if tenant already has accounts

GET    /api/config/account-mappings                             List mappings, joined with source config name + account names
PUT    /api/config/account-mappings                              Upsert one mapping (sourceType + sourceId + transactionKind + debit/credit account)
GET    /api/config/account-mappings/completeness                Count of expected vs. mapped transaction kinds (drives the UX completeness indicator)
```

## 7. Error Codes (new)

| Code | HTTP | Description |
|---|---|---|
| `ACCOUNT_CODE_INVALID_FORMAT` | 422 | Code doesn't match the category-prefix convention (§4) for the given category |
| `ACCOUNT_CODE_DUPLICATE` | 409 | Code already exists for this tenant |
| `ACCOUNT_IN_USE` | 409 | Cannot delete/deactivate — account is `isDefault=true` or referenced by an `AccountMapping` |
| `ACCOUNT_NOT_FOUND` | 404 | Account ID does not exist in tenant |
| `MAPPING_ACCOUNT_CATEGORY_MISMATCH` | 422 | Debit/credit account choice violates expected normal-balance direction for the transaction kind (e.g. mapping a DEPOSIT's credit side to an Aset account) |

Add to `Docs/api-conventions.md` alongside the existing table when implemented.

## 8. Enforcement

- **Package entitlement:** new `apps/backend/src/middleware/entitlement.middleware.ts` check (extends the pattern already introduced in `paket-langganan-design.md` §5) — all `/api/config/accounts*` and `/api/config/account-mappings*` routes require `"accounting"` present in `req.tenant.package.modules`, else `403 FEATURE_NOT_ENTITLED`.
- **Code format validation:** on create, `code` must start with the prefix matching `category` (§4) — `1-` for ASET, `2-` for KEWAJIBAN, `3-` for EKUITAS, `4-` for PENDAPATAN, `5-` for BEBAN — else `422 ACCOUNT_CODE_INVALID_FORMAT`.
- **Deletion guard:** `isDefault=true` accounts and any account referenced by an existing `AccountMapping` (as debit or credit) cannot be deleted or deactivated — `409 ACCOUNT_IN_USE`.
- **Mapping direction sanity check:** each `transactionKind` has an expected debit-category/credit-category shape (e.g. `DEPOSIT` should debit an Aset account and credit an Ekuitas/Kewajiban account per the Simpanan type's mapping). Validate at write time and return `422 MAPPING_ACCOUNT_CATEGORY_MISMATCH` on violation, rather than silently accepting a backwards mapping that would corrupt reports once the posting engine (Phase 2) exists.
- **Permission matrix:** add `"accounting": { "read": false, "create": false, "update": false, "delete": false }` to the default permission matrix shape (FSD §8.2); only `SUPER_ADMIN` gets it enabled by default, consistent with how `config`/`users`/`roles` are locked down for other default roles.

## 9. UI Changes

Tenant System Config → new **Konfigurasi Akun** section (only visible if tenant's package includes the `"accounting"` module):

- **Daftar Akun** tab: hierarchical tree/table view of accounts grouped by category, with an "Isi COA Standar" (seed default template) button shown when the list is empty.
- **Pemetaan Transaksi** tab: one row per Simpanan/Pinjaman config × transaction kind (Setoran, Penarikan, Pencairan, Pembayaran Pokok, Pembayaran Bunga/Margin, Denda), with debit/credit account dropdowns. Header banner shows the completeness indicator, e.g. "4 dari 9 jenis transaksi sudah dipetakan" — mirrors the quota-indicator pattern from `paket-langganan-design.md` §8.
- Account code field is locked (read-only) after creation to prevent accidental category-prefix drift.

## 10. Reporting Roadmap (phasing — informational, not committed scope)

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | COA configuration + account mapping (this spec) | Proposed |
| Phase 2 | Journal/posting engine — each `SavingTransaction`/`LoanPayment`/disbursement auto-generates a balanced journal entry using the mapping from Phase 1 | Future spec |
| Phase 3 | Ledger-derived financial statements — Neraca, Laporan Perhitungan Hasil Usaha (SHU), Laporan Arus Kas, Laporan Promosi Ekonomi Anggota, Catatan Atas Laporan Keuangan, replacing/supplementing today's RPT-01 aggregate report | Future spec |

Phase 1 alone delivers real value (a real COA tenants can reference, export, and hand to an external accountant) without committing to the much larger posting-engine build.

## 10a. Panel Research — Laporan Minimum Wajib Koperasi

Follow-up panel research (21 Juli 2026) into what a koperasi is legally required to produce, to sanity-check the Phase 3 report list above against actual regulation rather than assumption.

**Legal basis:**

- **UU No. 25/1992 tentang Perkoperasian, Pasal 35–36:** pengurus wajib menyusun laporan tahunan berisi minimal (a) perhitungan tahunan (neraca akhir tahun buku + perhitungan hasil usaha, berikut penjelasannya), dan (b) keadaan/perkembangan koperasi. Laporan ditandatangani seluruh pengurus dan disahkan (accountability) dalam Rapat Anggota. Rapat anggota wajib diadakan minimal sekali setahun (Pasal 26); praktik umum (Permenkop 19/2015 & edaran dinas daerah): RAT paling lambat 6 bulan setelah tutup buku.
- **Permenkop UKM No. 2/2024 (Kebijakan Akuntansi Koperasi)** — berlaku untuk KSP/USP, KSPPS/USPPS, dan koperasi sektor riil:
  - Laporan keuangan terdiri dari laporan **tahunan** dan **periodik**, disusun sebagai satu kesatuan laporan tahunan yang wajib dipertanggungjawabkan dan disahkan di RAT.
  - Set laporan keuangan (selaras SAK EP): **Neraca**, **Laporan Perhitungan Hasil Usaha**, **Laporan Arus Kas**, **Laporan Promosi Ekonomi Anggota**, **Catatan Atas Laporan Keuangan (CALK)**.
  - **Pasal 12:** KSP/USP dan KSPPS/USPPS dengan modal ≥ **Rp 5 miliar** dalam satu tahun buku **wajib diaudit** oleh akuntan publik terdaftar di Kemenkop UKM, berlaku mulai tahun buku 2025; rotasi KAP maksimal 3 tahun berturut-turut dengan jeda 2 tahun.
- **Praktik kelengkapan dokumen RAT** (pedoman isian RAT Kemenkop, dipakai dinas koperasi daerah): selain 5 laporan keuangan di atas, RAT juga mensyaratkan **Laporan Pertanggungjawaban Pengurus**, **Laporan Pengawas**, **Daftar Pembagian SHU per Anggota**, **Rancangan Rencana Kerja & RAPBK tahun berikutnya**, plus dokumen administratif (daftar hadir, notulensi RAT sebelumnya) yang bukan laporan keuangan.

**Inventaris laporan minimum:**

| # | Laporan | Dasar Hukum | Sifat | Status SISKOP |
|---|---|---|---|---|
| 1 | Neraca | UU 25/1992 §35; Permenkop 2/2024 | Laporan keuangan inti | Belum ada — Phase 3 |
| 2 | Laporan Perhitungan Hasil Usaha (SHU) | UU 25/1992 §35; Permenkop 2/2024 | Laporan keuangan inti | Sebagian — RPT-01 agregat, bukan SHU resmi |
| 3 | Laporan Arus Kas | Permenkop 2/2024 (SAK EP) | Laporan keuangan inti | Belum ada — Phase 3 |
| 4 | Laporan Promosi Ekonomi Anggota | Permenkop 2/2024 (SAK EP) | Laporan keuangan inti, koperasi-spesifik | Belum ada — perlu spek kalkulasi terpisah (lihat catatan panel di bawah) |
| 5 | Catatan Atas Laporan Keuangan (CALK) | Permenkop 2/2024 (SAK EP) | Laporan keuangan inti | Belum ada — sebagian akan tetap naratif/manual |
| 6 | Laporan Pertanggungjawaban Pengurus | UU 25/1992 §35–36; praktik RAT | Governance, bukan turunan ledger | Di luar cakupan modul akuntansi |
| 7 | Laporan Pengawas | UU 25/1992 §39; praktik RAT | Governance | Di luar cakupan modul akuntansi |
| 8 | Daftar Pembagian SHU per Anggota | Turunan Laporan HU + praktik RAT | Laporan keuangan turunan | Belum ada — butuh konfigurasi formula distribusi SHU (RPT-02 baru menyinggung "jika konfigurasi tersedia") |
| 9 | Rancangan Rencana Kerja & RAPBK tahun berikutnya | UU 25/1992 (agenda rapat anggota); praktik RAT | Perencanaan, bukan pelaporan historis | Di luar cakupan modul akuntansi |
| 10 | Laporan Audit Akuntan Publik | Permenkop 2/2024 Pasal 12 | Eksternal, wajib jika modal ≥ Rp5 miliar/tahun buku | Bukan output sistem — SISKOP hanya perlu menyediakan Neraca+CALK yang auditable |

**Panel takeaways:**

- **Product:** cakupan legal minimum untuk RAT lebih luas dari sekadar laporan keuangan — termasuk dokumen governance (Laporan Pertanggungjawaban Pengurus, Laporan Pengawas, Rencana Kerja/RAPBK) yang tidak berasal dari ledger transaksi sama sekali. Rekomendasi: modul akuntansi/pelaporan SISKOP dibatasi tegas ke 5 laporan keuangan SAK EP + Daftar Pembagian SHU per Anggota; dokumen governance jadi modul terpisah (mis. "Modul RAT") di roadmap lain, bukan dipaksakan masuk modul akuntansi ini.
- **Accounting/Compliance SME:** ambang audit wajib (modal ≥ Rp5 miliar, Permenkop 2/2024 Pasal 12, berlaku sejak tahun buku 2025) relevan untuk prioritas — tenant di atas ambang ini butuh Neraca+CALK yang auditable, sehingga Phase 2 (posting engine) lebih mendesak untuk segmen ini daripada dianggap "nice to have" generik. Rekomendasi: pakai ukuran modal/aset tenant sebagai sinyal prioritas rollout, bukan asumsi semua tenant butuh sama.
- **Compliance:** Laporan Promosi Ekonomi Anggota tidak bisa diturunkan murni dari saldo akun (Account/AccountMapping, Phase 1) atau posting jurnal (Phase 2) — ini laporan terhitung yang menunjukkan manfaat ekonomi tiap anggota (bunga/bagi hasil simpanan diterima, selisih bunga pinjaman vs pasar, dll.), bukan laporan turunan neraca saldo. Perlu spesifikasi kalkulasi tersendiri sebelum masuk Phase 3 — dicatat sebagai gap riset, bukan diasumsikan otomatis selesai begitu ledger ada.
- **Backend:** rekomendasi menambahkan field modal/aset tenant (jika belum ada di `Tenant`/`SubscriptionPackage`) supaya sistem bisa memberi notifikasi proaktif — "koperasi Anda mendekati/telah melewati ambang Rp5 miliar, laporan keuangan wajib diaudit akuntan publik terdaftar Kemenkop UKM" — sebagai pengingat kepatuhan, bukan penegakan otomatis.

## 11. Explicit Assumptions

- The default template (§4) is a reasonable starting point for a typical Koperasi Simpan Pinjam under SAK EP, not a certified/audited chart — tenants (or their accountant) remain responsible for adapting it to their specific reporting obligations.
- `AccountMapping` for existing `SavingConfig`/`LoanConfig` records is opt-in and retroactive-only in the sense that it affects future postings once Phase 2 exists; this spec does not back-fill historical `SavingTransaction`/`LoanPayment` rows into any ledger, since no ledger exists yet.
- Multi-currency, cost-center/departmental accounting, and inter-tenant consolidated reporting are not considered — out of scope for a single-tenant koperasi.

## 12. Out of Scope (this spec)

- Journal/posting engine (Phase 2, §10)
- Auto-generated Neraca / Laporan Perhitungan Hasil Usaha / Laporan Arus Kas / Laporan Promosi Ekonomi Anggota (Phase 3, §10)
- Migrating historical `SavingTransaction`/`LoanPayment` records into ledger entries
- Changes to today's RPT-01/RPT-02 aggregate financial/RAT reports (unchanged, continue to work independently of this module)
- Multi-currency or consolidated multi-tenant accounting
