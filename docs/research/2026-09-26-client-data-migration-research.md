# Research: Client Data Migration — Best Practice for Onboarding Existing Koperasi

> Date: 2026-09-26 · Context: SISKOP v3 · Status: research only, no code yet
> Inputs: the attached RAT workbook `Bissmillah_persiapan_RAT_2025.xlsx` (Kopkar UM Surabaya),
> `apps/backend/scripts/import-kopkar-umsurabaya.ts` (the existing one-off importer),
> `apps/backend/prisma/schema.prisma`, and external references (listed at the end).
> No PDF was attached. Case 3 is written from research. The workbook is the source that
> RAT PDFs are printed from, so it shows the same data.

## 1. Recommendation (TL;DR)

1. **Build one pipeline with three front doors, not three importers.** Every source (legacy
   DB, spreadsheet, PDF) is converted into a single **canonical staging template**. From there
   one shared engine validates it, **reconciles it against the source's balance sheet**, shows
   a preview, and commits it. Only the adapter (step 1) differs per case.
2. **Migrate balances, not history ("balance-forward" at a cutover date).** For koperasi the
   natural cutover is **the closing date of the last audited or RAT-approved book year**
   (e.g. 31 Dec 2025). Opening balances are then the numbers the Rapat Anggota already
   approved. History before the cutover goes to a read-only archive and is never re-journaled.
3. **The reconciliation gate is the product.** A migration may commit only when
   Σ member sub-ledgers = the balance-sheet line for every account, and the opening trial
   balance nets to zero. **No automatic "plug" to equity.** Every difference is shown to the
   client, and each one is either fixed at the source or booked as a named, signed-off
   adjustment.
4. **Opening balances post against a dedicated clearing account ("Saldo Awal Migrasi"),
   dated at the cutover, with their own journal source type.** That account must be exactly
   zero after commit. Opening savings are **not** "deposits". They never touch Kas.
5. **Missing KYC is a status, not placeholder data.** Legacy files rarely carry NIK, address
   or birth date. Import members as `DATA_INCOMPLETE` and collect KYC afterwards. Never invent
   NIKs, because NIK is the key for central member login.
6. **Case priority:** Case 2 (spreadsheet) first, since it is the most common and the other
   two reduce to it. Then Case 3 (PDF, as an assisted AI-extraction step that outputs the
   Case 2 template). Case 1 (legacy) is delivered as a service per source system at first,
   and becomes a product feature only once the same legacy vendor appears more than once.

## 2. What the sample workbook tells us

The file is a typical Indonesian koperasi RAT preparation workbook: 10 sheets, print-layout
headers (rows 1–12), merged cells, signature blocks under each table, and a `master` sheet
that the printed sheets were copied from.

| Sheet | Content | SISKOP target |
|---|---|---|
| `Simpanan Anggota` | Pokok+Wajib per member, balance 2024 plus 2025 movement | `Saving` (POKOK/WAJIB) |
| `Modal SR TQ` | Modal, Tabungan Sukarela, Tabungan Qurban per member | `Saving` (SUKARELA products) |
| `Pembiayaan` | Up to 2 financings per member: remaining months, monthly pokok, monthly infaq (margin) | `Loan` (SYARIAH, MARGIN) |
| `Neraca` | Balance sheet 2024 vs 2025 | Opening trial balance (the control totals) |
| `Pembagian SHU`, `Presentase SHU` | SHU 2025 allocation per member and policy | Reference only. SHU 2025 is already closed. |
| `arus kas` | Monthly cash flow | Reference / sanity check |
| `inventaris` | Fixed-asset register | Opening fixed assets |
| `master` | The working sheet everything is derived from | Best candidate source |

### Findings that shape the design

All figures below were computed directly from the attached file.

1. **The printed "Total" rows do not equal the sum of their own detail rows.** These sheets
   contain no formulas, so the totals are pasted values:

   | Sheet / column | Σ detail rows | "Total" row | Difference |
   |---|---:|---:|---:|
   | Pembiayaan — total outstanding | 5,832,252,900 | 5,304,751,900 | **+527,501,000** |
   | Simpanan Anggota — pokok+wajib | 1,140,356,000 | 1,161,166,000 | −20,810,000 |
   | Modal SR TQ — Modal | 2,849,472,800 | 2,940,172,800 | −90,700,000 |
   | Modal SR TQ — grand total | 3,656,088,300 | 3,841,964,000 | −185,875,700 |
   | Pembagian SHU — total | 240,870,000 | 241,370,000 | −500,000 |

   The **Neraca ties to the Total rows**, not to the detail. For example, Piutang 5,139,858,700
   + Piutang Macet 164,893,200 = 5,304,751,900. So the member-level detail and the approved
   balance sheet disagree by more than Rp 500 million on financing alone. The `master` sheet
   shows the same pattern for financing, although its savings column (X) does tie to its total.
   **Lesson:** a spreadsheet's own totals can't be trusted. The importer must recompute every
   control total and compare it against the Neraca.
2. **The same figure appears three different ways.** Modal is 2,849,472,800 (detail),
   2,940,172,800 (Modal sheet total) and 2,890,172,800 (`master` total). Sukarela 2025 differs
   by the same Rp 50 M in the opposite direction between the sheets, which looks like a
   reclassification that was applied in one sheet only.
3. **The member number is not a unique key.** `No Anggota` 226 and 666 each belong to two
   different people. 82 of 341 rows in `Simpanan Anggota` have no member number at all, and
   `master` has 769 named rows but only 297 with a number.
4. **Names don't join reliably across sheets.** "solikin, ST MT" vs "Solikin, ST., MT". Some
   names carry annotations such as "(M)", "(jukir)", "(DPK)" or "Sri Haryati / sri widodo".
   11 financing rows name people who are not on the savings roster. The member number mostly
   does join where it exists, and the existing importer joins on the normalized name instead.
5. **Non-member rows are mixed into member tables:** "Kopkar" (Rp 19.97 M of Modal) and
   "bunga admin dan pajak bank jatim".
6. **Negative values encode withdrawals** (41 negative cells in `master`, e.g. a 2024 balance
   of 5,785,000 with −4,385,000 in 2025).
7. **The source contains accounting errors that migration must not "fix" silently:**
   - "Penyusutan" (accumulated depreciation, 5,300,000) is *added* to Aktiva rather than
     deducted.
   - Kas is 280,654,800.33 (fractional rupiah from ⅓-month averaging in `arus kas`).
   - "Asuransi Pinjaman" (32,893,100, a liability) has no counterpart in the importer's COA.
   - The Neraca's "Simpanan Sukarela" line (3,841,964,000) actually contains Modal + Sukarela
     + Qurban.
8. **No KYC data at all.** No NIK, address or birth date. `Member.nik`, `address`,
   `birthPlace`, `birthDate` and `occupation` are all non-null in the schema.
9. **Financing is stated as "remaining months × monthly installment".** Jumlah = months × pokok
   holds for every row. There is no original principal, disbursement date or contract
   number. The monthly infaq is the syariah margin.
10. **Print artefacts:** hidden rows 6–9, header bands spread over 2–3 merged rows, signature
    blocks inside the data range, and an external workbook link in `master`
    (`'[1]Presentase SHU'!…`).

## 3. Lessons from the existing one-off importer

`apps/backend/scripts/import-kopkar-umsurabaya.ts` got a tenant live quickly, but it
illustrates the anti-patterns a productized migration must avoid:

| What the script does | Why it is a problem | Best-practice replacement |
|---|---|---|
| Opening savings go through `createSaving(... initialDeposit)` → **Dr Kas / Cr Simpanan** | Books ~Rp 5 bn of fictitious cash receipts, dated at run time rather than the cutover date (`entryDate: transaction.createdAt`). The Arus Kas for the cutover period becomes meaningless. | Opening balances post **Dr Saldo Awal Migrasi / Cr Simpanan**, dated at the cutover, with source type `OPENING_BALANCE` |
| One final "Saldo Migrasi" entry **plugs the difference into Cadangan** | Every discrepancy is silently absorbed into equity. From §2, the plug absorbs the +527 M financing gap, double-counts Piutang Macet (all loans imported as LANCAR *plus* a separate 164.9 M macet line), and pulls Asuransi Pinjaman and Penyusutan into Cadangan. Neraca Cadangan is 72,270,200, and the plug result would be far from it. | Reconciliation gate: the clearing account must be zero. The residual is a blocking error, listed per line. |
| Joins sheets on normalized name | Fails on the name variants in §2.4 and would merge two different people with the same name | Join on the legacy member number with a (number, name) pair check; ambiguous matches go to a review queue |
| Placeholder NIK `35000000000000NN`, address "belum dilengkapi", birthDate 1990-01-01 | Placeholder data looks real. NIK drives `/api/member-access/login`. Reports (demographics, age) are wrong. | Nullable KYC with a `DATA_INCOMPLETE` status and a completion workflow |
| Hardcoded targets (`TARGET_KAS = 280_654_800`) and a hardcoded admin password in source | Not repeatable, and a secret sits in the repo (CLAUDE.md rule 6) | Targets come from the uploaded Neraca. Admin is invited through the normal onboarding flow. |
| Non-idempotent: aborts if the tenant exists, no rollback | A half-finished import has to be cleaned up manually | Import batch id on every row, dry-run mode, one transaction per batch, and a tenant-level "discard migration" while in the pre-go-live state |
| Figures parsed with `Number()` | Money handled as float (CLAUDE.md rule 2) | Parse to `Decimal` from the string, with an explicit rounding policy |

## 4. Best-practice principles (apply to all three cases)

Drawn from accounting-system conversion guidance (balance-forward / opening-balance migration,
trial-balance validation, parallel run) and SaaS import UX practice.

1. **Cutover date = book-year close.** Opening balances equal the audited or RAT-approved
   Neraca. Transactions between the cutover and go-live (a RAT is usually held 3–6 months
   after year end) are loaded as a **catch-up**, either as monthly per-member summaries or
   as real transactions, and must reconcile to the legacy system's current balances on the
   go-live date.
2. **Balance-forward, plus open items in detail.** Account balances per member are required.
   Open items (each active financing) are loaded individually, never as a lump sum. Closed
   history is archived (original files stored and linked to the batch) and not journaled.
3. **Reconcile at two levels.** (a) Sub-ledger to GL: Σ member savings of product X =
   the Neraca line for X; Σ outstanding financing = Piutang (lancar + macet). (b) GL to the
   source: the opening trial balance equals the source Neraca line by line. Differences are
   classified as *source error*, *mapping error* or *known adjustment*.
4. **Stage → validate → preview → commit.** Nothing touches live tables until a person has
   seen the preview (member count, per-product totals, opening Neraca side by side with the
   source Neraca) and pressed commit.
5. **Rehearse.** Run at least one full dry run on a sandbox tenant before the real run.
   Freeze the legacy data at cutover.
6. **Parallel run for one period** (usually one month) for Case 1, and ideally for Case 2.
   The client keeps the old books, and month-end balances are compared.
7. **Sign-off is a first-class artifact.** Pengurus (Ketua/Bendahara) and ideally Pengawas
   sign the reconciliation report (the preview as PDF). It becomes the audit trail for the
   opening balances under SAK EP / Permenkop reporting.
8. **Idempotent and traceable.** Every migrated row carries `importBatchId` and its source
   reference (file, sheet, row, legacy id), so any figure can be traced back to its cell.

## 5. Target architecture in SISKOP terms

```
 Case 1 legacy DB/export ─┐
 Case 2 xlsx/csv ─────────┼─► [Adapter] ─► Canonical staging template ─► Validate ─► Reconcile gate ─► Preview & sign-off ─► Commit ─► Go-live
 Case 3 PDF ──────────────┘                (MigrationBatch + rows)     (row errors) (vs source Neraca)   (PDF report)          (opening journal)
```

### 5.1 Canonical staging template (the contract between adapters and the engine)

A downloadable SISKOP `.xlsx` template, one sheet per entity. Required columns are marked \*.

| Sheet | Columns |
|---|---|
| `Anggota` | legacyMemberNo\*, fullName\*, nik, address, birthPlace, birthDate, occupation, phone, joinDate, status (AKTIF/KELUAR), isPengurus, isPengawas, unit |
| `Simpanan` | legacyMemberNo\*, product\* (mapped to a SavingConfig), balance\* (as of cutover) |
| `Pembiayaan` | legacyMemberNo\*, contractNo, product\*, originalPrincipal, disbursedAt, termMonths, remainingPrincipal\*, remainingMargin (syariah) / accrued interest, monthlyInstallment, remainingInstallments, daysOverdue / kolektibilitas |
| `Neraca` | accountCode or legacy account name\*, balance\* (as of cutover) → mapped to the COA |
| `AsetTetap` (optional) | name, acquisitionDate, cost, accumulatedDepreciation |

Rules: amounts are plain numbers (no "Rp", no thousands separators) and are parsed to `Decimal`.
One row per member per product. Negative balances are rejected unless the product allows them.

### 5.2 Validation (row level, shown inline, fixable before commit)

- Required fields, types, and date formats (Indonesian `dd/mm/yyyy` as well as ISO).
- Duplicate `legacyMemberNo` pointing to different names → blocking.
- Same person under two numbers (fuzzy name match after stripping academic titles such as
  "Dr.", "S.Kep", ",M.Pd") → warning, sent to a review queue.
- A sub-ledger row whose member is not in `Anggota` → blocking.
- NIK: 16 digits, unique within the tenant. Absent → member is flagged `DATA_INCOMPLETE`.
- Financing: remainingPrincipal ≈ remainingInstallments × monthly principal (±Rp 1,000
  tolerance), kolektibilitas consistent with daysOverdue.
- Non-member rows (names with no member number and matching an org/bank pattern) → the user
  must classify each one explicitly.

### 5.3 Reconciliation gate (batch level, blocking)

For each Neraca line mapped to a product-backed account:
`Σ staged sub-ledger rows == staged Neraca balance` → green / red with the difference.
The opening trial balance must balance (Σ debit = Σ credit), and the **Saldo Awal Migrasi**
clearing account must end at exactly 0. Lines not backed by a product (Kas, Inventaris,
Cadangan, SHU belum dibagi, Asuransi Pinjaman …) are taken from the Neraca as-is, but every
Neraca line must map to a COA account. There is no "other" bucket.

An operator may record an **explicit adjustment** (reason text, amount, target account)
to bridge a known difference. It shows as its own line on the sign-off report. This is the
same append-only, explained pattern that `ModalSendiriAdjustment` already uses.

### 5.4 Commit (accounting)

- Members: `Member` rows, with `legacyMemberNo` kept for search. The SISKOP `memberId` is still
  generated, because it is globally `@unique`.
- Savings: `Saving.balance = staged balance`, plus one `SavingTransaction` of a new type
  `OPENING_BALANCE` dated at the cutover (keeps the savings statement's running balance correct).
- Financing: `Loan` created with the known remaining state (as the script does), including
  remaining margin. For syariah murabahah the receivable and the deferred margin are shown
  separately (PSAK 102 presentation: piutang murabahah less margin ditangguhkan). This needs
  accountant confirmation.
- Journal: **one** `JournalEntry` per unit, `sourceType = OPENING_BALANCE`,
  `entryDate = cutover`, containing every opening line against the clearing account. Reports
  then show a proper "Saldo Awal" and not thousands of fake deposits.
- Everything runs in one DB transaction per batch. A batch can be discarded only while the
  tenant is still in a pre-go-live `MIGRATING` state.

### 5.5 Schema / product gaps to decide before building

| Gap | Proposed change |
|---|---|
| `Member.nik/address/birthPlace/birthDate/occupation` are non-null | Make them nullable and add `dataStatus` (`COMPLETE`/`INCOMPLETE`). Keep `@@unique([tenantId, nik])` (Postgres allows multiple NULLs). Portal activation requires `COMPLETE`, since NIK login depends on it. |
| No legacy identifier | `Member.legacyMemberNo String?` (not unique, because of §2.3) plus an index |
| No opening-balance semantics | `JournalSourceType.OPENING_BALANCE`, `TransactionType.OPENING_BALANCE`, and a system COA account "Saldo Awal Migrasi" |
| No traceability | `MigrationBatch` model (tenantId, source kind, cutover date, status DRAFT/VALIDATED/COMMITTED/DISCARDED, uploaded file refs, reconciliation snapshot, signed-off by/at) and `importBatchId` on created rows |
| Loans lack contract metadata | `Loan.contractNo String?`, `Loan.originalPrincipal Decimal?` (nullable for migrated loans where it is unknown) |
| Tenant lifecycle | `Tenant.goLiveAt` / `MIGRATING` state, so staff can't post live transactions over a half-migrated book |

Each of these is a schema change, so per CLAUDE.md the Engineer decides.

## 6. Per-case procedure

### Case 1 — Client has a legacy system

**Best practice:** extract from the data layer (DB dump, vendor export, API), never by
re-typing reports. Legacy exports carry stable identifiers (member id, account/contract
numbers) and give both the balances and the transaction history.

1. **Discovery (1–2 days):** identify the vendor or system and the export options. Get the
   member master, savings accounts with balances, active loans with schedules, the COA, and
   a trial balance as of cutover. Check that the contract gives the koperasi the right to
   export its own data (a common blocker with local vendors).
2. **Mapping workshop:** legacy products → SavingConfig/LoanConfig, legacy COA → SISKOP COA
   (by `Account.code`), legacy statuses → `LoanStatus`/`KOLCategory`.
3. **Adapter:** a small per-vendor script that turns the export into the canonical template
   (§5.1). The first time a vendor appears it is service work (our team writes the adapter).
   When a vendor recurs, the adapter becomes a selectable "source system" in the UI.
4. **Dry run** on a sandbox tenant → reconciliation report → fix → repeat until green.
5. **Freeze + final extract** at cutover → commit → **parallel run for one month** →
   compare the month-end trial balance and 10–20 sampled member statements → decommission
   the legacy system.
6. **History:** keep the full legacy export as an archived attachment of the batch
   (UU 8/1997 on company documents requires ~10-year retention of bookkeeping records).
   Optionally import historical transactions as *non-journaled* statement lines so members
   see their past in the portal. Never re-journal them.

### Case 2 — Client kept books manually in Excel/CSV (the attached file)

**Best practice:** a template-first self-service importer, with an assisted path for
workbooks like the attached one.

1. **Self-service path:** the client downloads the SISKOP template, fills it, uploads it, maps
   any non-template columns (auto-suggested by header similarity), and sees row errors inline
   with in-place fixes (the Flatfile/OneSchema pattern: File → Map → Validate → Submit).
2. **Assisted path (expected to be the majority):** the client uploads their RAT workbook as is.
   Our onboarding team (or an AI-assisted converter, see Case 3) builds the template from it.
   For this file, `master` is the best source because it is the only sheet with every member,
   and its 472 named rows without a member number must be triaged. The client confirms the result.
3. **Reconcile against the RAT Neraca.** With this file the gate would stop the migration
   immediately (§2.1: financing detail is +527.5 M over the Neraca). That is the correct
   outcome. The Bendahara must say which figure is true before anything is committed.
4. **Sign-off, commit, go-live.** A parallel run is recommended if the client continues its
   spreadsheet for a month.

Do **not** try to auto-parse arbitrary RAT workbooks in the product. The layouts (merged
headers, year-split columns, signature blocks, pasted totals) vary per koperasi, and a
parser tuned to one file silently mis-reads the next.

### Case 3 — Client only has PDF reports

**Reality check:** a RAT PDF is a *report*, so it is the weakest source. It has balances as of
year end, often no member numbers, no KYC, and no loan contract detail. It works for opening
balances, and nothing more.

1. **Classify the PDF:** digital (a text layer exists) vs scanned (image, needs OCR).
2. **Extract:** for digital PDFs, `pdfplumber` is the most reliable open-source table extractor
   for border-less financial tables. Camelot works for ruled tables. For scanned or messy
   layouts, a vision LLM (Claude) extracts each table page to JSON in the canonical schema.
   Research and practice converge on a **hybrid** approach: a deterministic extractor first,
   LLM cleanup and structuring next, then human review.
3. **Mandatory human review, side by side** (the PDF page image next to the extracted rows),
   since table extraction almost always needs some manual repair. Show a per-page
   confidence score and flag every page where Σ extracted rows ≠ the PDF's own printed total.
4. **The output is a Case 2 template.** From here the flow is identical: validation,
   reconciliation against the PDF's own Neraca page, sign-off.
5. **Fill the gaps separately:** KYC through a member self-registration or verification
   campaign (the existing `MemberRegistrationRequest` flow can be reused), and loan contract
   details from the physical contract files, as a post-go-live task.

Privacy: member data (names and, if present, NIK) must not be sent to a third-party
LLM without a legal basis. Under UU 27/2022 (PDP), SISKOP processes data on behalf of the koperasi
as the controller. Cover LLM processing in the DPA, use a zero-retention API configuration,
and redact NIK before extraction where possible.

## 7. Suggested phasing

| Phase | Scope | Why first |
|---|---|---|
| **P0 — foundation** | Schema gaps (§5.5), `OPENING_BALANCE` posting, `MigrationBatch`, reconciliation engine + report, canonical template, commit/discard. Staff-only (platform-admin) UI. Re-run Kopkar UMS through it. | Every case needs it. Also fixes the Kopkar UMS opening books. |
| **P1 — Case 2 self-service** | Tenant-facing upload → map → validate → preview → sign-off wizard | Most common source |
| **P2 — Case 3 assisted** | PDF → template extractor (pdfplumber + Claude vision), review UI | Reuses P0/P1. Handles the weakest sources. |
| **P3 — Case 1 adapters** | Per-vendor adapters as demand appears, plus a catch-up/parallel-run comparison tool | Varies too much per vendor to build speculatively |

## 8. Open decisions (PM / Engineer / client)

1. **Kopkar UMS:** which financing figure is correct, detail (5.83 bn) or Neraca (5.30 bn)?
   Should the existing tenant be re-migrated through P0 once the figure is settled? (Client
   Bendahara + PM)
2. Should "Modal" be a SUKARELA saving product, or Modal Penyertaan (equity, *not* part of
   Modal Sendiri per the 2026-09-25 modal-disetor research)? This changes the Neraca and BMPP.
   (Engineer + accountant)
3. Syariah financing presentation: gross receivable with deferred margin, or net principal?
   (Accountant)
4. Is migration a paid onboarding service, a self-service feature, or both (per tier)? (PM)
5. The acceptable tolerance in the reconciliation gate: Rp 0, or rounding ≤ Rp 1 per line
   (for the fractional Kas)? (QA + accountant)

## Sources

- [Striven — Accounting Migration guide (opening-balance / cutover-date migration)](https://www.striven.com/support/guides/accounting-migration)
- [ClonePartner — Accounting Data Migration Checklist (trial balance validation, parallel run)](https://clonepartner.com/blog/accounting-data-migration-checklist-the-10-point-plan)
- [Platform Transition — 10-step accounting data migration process (data scrub)](https://platformtransition.com/accounting-data-migration/)
- [Ramp — Accounting data migration: steps & strategies](https://ramp.com/blog/accounting-data-migration)
- [QuickBooks — Data migration tips](https://quickbooks.intuit.com/r/midsize-business/data-migration/)
- [CSVBox — Best UX flow for spreadsheet imports (File → Map → Validate → Submit)](https://blog.csvbox.io/spreadsheet-import-ux/)
- [Flatfile — Building a seamless CSV import experience](https://flatfile.com/blog/optimizing-csv-import-experiences-flatfile-portal/)
- [OneSchema — Advanced CSV import features](https://www.oneschema.co/blog/advanced-csv-import-features)
- [Unstract — Extracting tables from PDF with Python (2026)](https://unstract.com/blog/extract-tables-from-pdf-python/)
- [Tabula vs Camelot vs pdfplumber in 2026](https://dev.to/martin_pdfexcel/tabula-vs-camelot-vs-pdfplumber-in-2026-which-python-library-actually-wins-22kn)
- [Tabular PDF extraction with LLMs and layout-aware parsing: a reliability evaluation (arXiv 2604.00003)](https://arxiv.org/pdf/2604.00003)
- [Camelot documentation](https://camelot-py.readthedocs.io/)
- Regulatory references (from domain knowledge, not re-verified in this pass): UU 8/1997
  Dokumen Perusahaan (retention), UU 27/2022 Pelindungan Data Pribadi, PSAK 102 Murabahah,
  SAK EP, Permenkop UKM 2/2024 & 8/2023 (see `docs/research/2026-09-25-modal-disetor-deep-research.md`).
