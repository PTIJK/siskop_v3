# KSP Reporting System: Function, Formula and Design Reference

Reference for rebuilding or improving the reporting layer in Siskop. Source: the KSP codebase (`Backend/` NestJS + TypeORM + PostgreSQL, `Frontend/main-end/` Vue 2 + Vuetify 2).

**How to read this document**
- Everything marked **[verified]** was read directly in code.
- **[inferred]** means deduced from naming or a sibling code path and not confirmed line by line.
- **[bug / smell]** marks behaviour that is probably unintended. Do not copy these into Siskop. Section 9 lists them together.
- Scope: the financial, operational and dashboard reports. The Kas screens (Manajemen Kas, Rekap Kas, Form Kas) are described at UI level only; `kas.service.ts` was not analysed.

---

## 1. Architecture at a glance

```
 Transaction services                       Report services                 UI
 (simpanan / deposito / pembiayaan / kas)   (InsightService)
        │                                          ▲
        │ in ONE DB transaction writes:            │ read + aggregate in Node (JS)
        ▼                                          │
 ┌─────────────┐  ┌──────────────────┐  ┌──────────┴───────────┐
 │ transaksi   │  │ transaksi_kode_  │  │ log_laporan  (ledger) │──► Jurnal Umum, Jurnal Penyesuaian,
 │ (receipt)   │  │ akun (Dr/Cr line)│  │ laporan_pegawai       │    Buku Besar, Neraca, Laba Rugi
 └─────────────┘  └──────────────────┘  │ laporan_pasar         │──► Laporan Pegawai, Laporan Pasar
        │                               │ laporan_akad          │    (Laporan Akad now recomputed live)
        ▼                               └───────────────────────┘
 kode_akun.saldo (running balance mutated directly)  ──► Detail Saldo Akun, Manajemen Kas cards
```

Key design facts:
1. **There is no report-time journal derivation.** Every business transaction writes its own journal lines into `log_laporan` at the moment it happens. Financial reports are sums over `log_laporan`.
2. **Report tables are write-time snapshots.** `laporan_pegawai`, `laporan_pasar` and `laporan_akad` get a row per transaction (denormalised, with IDs stored as strings).
3. **All aggregation happens in Node, not SQL.** The services load whole tables with relations, then loop and filter with `moment`. This is simple but slow at scale.
4. **Multi-office.** Every ledger row carries `office`. Every report takes an optional `officeId`; `null` means all offices.
5. **Endpoints:** `POST /financial-reporting/*` (all JWT-guarded) and `GET /dashboard/*`.

### Data model used by reports

| Table | Important columns | Role |
|---|---|---|
| `kode_akun` | `kode` (varchar), `nama`, `saldo`, `tipe` (1 NERACA, 2 LABARUGI), `isDebit` (normal balance) | Chart of accounts (COA) |
| `log_laporan` | `kodeAkun`, `office`, `saldoDebit`, `saldoKredit`, `tipe` (0 UMUM, 1 PENYESUAIAN), `createDateTime` | The ledger. One row per journal line |
| `transaksi` | `noKuitansi`, `keterangan`, `employee` | Receipt header; links to simpanan/deposito/pembiayaan/kas lines |
| `transaksi_kode_akun` | `transaksi`, `kodeAkun`, `isDebit`, `nominal` | Journal lines attached to a receipt |
| `laporan_pegawai` | `namaKantor`, `namaPasar`, `namaPegawai` (IDs), `riwayatTrx` (text), `debit`, `kredit` | Employee activity feed |
| `laporan_pasar` | `namaPasar` (ID), `totalNasabah`, ... , `ReferenceTypeEnum` | Market snapshot rows |
| `laporan_akad` | `namaKantor`, `namaPasar`, `kodeAkad`, `namaAkad`, `totalTrx`, `totalNilaiTrx` | Contract-type snapshot rows (legacy path) |

### Common request DTOs
- `DateDTO`: `{ startDate, endDate, officeId? }`, dates as `YYYY-MM-DD`.
- `OfficeStartDateEndDateDTO`: same shape; used by Jurnal Umum, Neraca, Buku Besar.
- `LaporanPegawaiSpesifikDTO`: adds `employeeId`.

---

## 2. Chart of accounts (COA) used by the reports

Source: `src/data/kode_akun_versi_dua.json` **[verified]**. Codes are 5-digit strings forming a 3 to 4 level tree by zero-padding: `10000 → 11000 → 11100 → 11101`.

| Group | Parent code | Normal balance | Notes |
|---|---|---|---|
| Aset | 10000 | Debit | 11000 Aset lancar (11100 Kas, 11200 Bank, 11300 Piutang, 11400 Investasi), 12000 Aset tetap, 13000 Aset lain-lain |
| Liabilitas | 20000 | Kredit | 21000 jangka pendek, 22000 jangka panjang, 23000 dana peserta (23001 dana investasi peserta, 23002 dana tabarru'/hibah) |
| Equity / Modal | 30000 | Kredit | 31000, 32000 (32001 tambahan modal, 32002 OCI, **32003 saldo laba**), 33000 |
| Pendapatan | 40000 | Kredit | 41000 (41001 pendapatan SHU), 42000 non operasional |
| Biaya | 50000 | Debit | 51000 to 55000 |
| Pajak | 60000 | Kredit (as flagged in JSON) | Taksiran pajak penghasilan |

Contra accounts (`isDebit=false` under asset): 12007 to 12011 and 13002 (accumulated depreciation). `32003` is flagged `isDebit=true` although it sits in equity.

Special accounts the posting code hard-codes:

| Code | Meaning in transactions |
|---|---|
| `11102` | Kas teller / kas besar: the cash account for almost every transaction |
| `23001` | Dana investasi peserta: the liability for member savings and deposits |
| `23002` | Dana tabarru': social-fund contributions |
| `41001` | Pendapatan SHU: financing margin income, and also the debit side of profit-sharing paid to savers |
| `42000` | Pendapatan non-operasional: balance of closed savings accounts |
| `51001` | Beban pengelolaan portofolio (used in deposito withdrawal) |
| `11301` to `11314` | Piutang per akad: financing code is mapped from the akad code (see 3.1) |

---

## 3. Journal posting rules (how the ledger gets filled)

Reports are only as right as these postings. Each pair is written twice: as `transaksi_kode_akun` lines and as `log_laporan` rows (`tipe=0`, with the employee's office).

### 3.1 Postings per transaction

| Transaction | Debit | Kredit | Source |
|---|---|---|---|
| Simpanan setoran (deposit into savings) | 11102 Kas | 23001 Dana investasi | simpanan.service **[verified]** |
| Simpanan penarikan (withdrawal) | 23001 | 11102 | reverse **[inferred]** |
| Simpanan penutupan rekening (balance to income) | 23001 | 42000 | **[bug]** see section 9 |
| Simpanan bagi hasil (monthly) | 41001 | 23001 | `autoDebitBagiHasilSimpanan` cron **[verified]** |
| Deposito setor (Sijaka) | 11102 | 23001 | deposito.service **[verified]** |
| Deposito tarik pokok | 23001 | 11102 | **[verified]** |
| Deposito bagi hasil (daily cron 22:00) | 41001 | 23001 | **[verified]** |
| Pembiayaan pencairan (disbursement) | Piutang by akad (see table below) | 11102 | pembiayaan-tarik.service **[verified]** |
| Dana sosial at disbursement | 11102 | 23002 | **[verified]** |
| Pembiayaan angsuran, pokok | 11102 | Piutang by akad | pembiayaan.service **[verified]** |
| Pembiayaan angsuran, markup/basil | 11102 | 41001 | **[inferred]** from account lookups |

Piutang account by akad code (financing product). Partly verified: VII → 11302, VIII → 11308, IX/XI → 11309, X → 11311, XII → 11305, XIII → 11306, XIV → 11307. The other mappings (I to VI) sit above the lines read; copy the full `if/else` chain from `pembiayaan-tarik.service.ts` (around line 120) when rebuilding.

### 3.2 Types of ledger entry (`log_laporan.tipe`)
- `0 = UMUM`: normal journal. Feeds Jurnal Umum, Buku Besar, Neraca, Laba Rugi.
- `1 = PENYESUAIAN`: adjusting entries (for example corrections/koreksi). Feeds only Jurnal Penyesuaian. **Not** included in Buku Besar, Neraca or Laba Rugi, because those only filter by date and office, not `tipe`. See bug B6.

---

## 4. Financial reports

All accept `startDate`, `endDate`, optional `officeId`. Date filter is inclusive on both ends.

### 4.1 Jurnal Umum (General Journal)
- **Endpoint:** `POST /financial-reporting/jurnal-umum`
- **Function:** chronological list of every journal line, so an accountant can audit what hit which account when.
- **Query:** `log_laporan JOIN kode_akun` where `tipe = 0`, optional `officeId`, ordered by `createDateTime ASC`. Date range is then applied in JS after fetching **all** rows.
- **Output row:** `{ createDateTime, kode, nama, debit, kredit }`
- **Formula:** none (listing). Total row in UI = Σ debit and Σ kredit; they must be equal.
- **UI columns:** No, Tanggal Input, Kode Akun, Nama Akun, Debit, Kredit.

### 4.2 Jurnal Penyesuaian (Adjusting Journal)
- **Endpoint:** `POST /financial-reporting/jurnal-penyesuaian`
- Same as 4.1 with `tipe = 1`. The output keys are `saldodebit` / `saldokredit` (different from 4.1).
- The result is passed through `autoSumDebitKredit`, which only affects rows whose `kode` is a parent code; for plain journal lines it is effectively a no-op.

### 4.3 Buku Besar (General Ledger, summary form)
- **Endpoint:** `POST /financial-reporting/buku-besar`
- **Function:** per account, total debit and total credit movement in the period, with group (parent) rows rolled up.
- **Algorithm:**
  1. Load all `kode_akun` ordered by `kode`, with their `logLaporan` and `office`.
  2. For each account: `saldodebit = Σ log.saldoDebit`, `saldokredit = Σ log.saldoKredit` for rows with `createDate ∈ [start, end]` (and `office = officeId` if given; rows with `office = null` are skipped when an office is selected).
  3. Accounts with no ledger rows get `0 / 0`.
  4. `autoSumDebitKredit` rolls child totals into parent rows (4.6).
- **Output row:** `{ id, kode, nama, saldodebit, saldokredit }`
- **Note:** this is a movement summary, not a running-balance ledger per account. It has no opening balance and no per-transaction lines.

### 4.4 Neraca (Balance Sheet / Laporan Posisi Keuangan)
- **Endpoint:** `POST /financial-reporting/neraca`
- **Function:** position per account: opening balance, period movement, closing balance.
- **Per account formula** (`isDebit` = the account's normal side):

```
saldoDebitA / saldoKreditA = Σ debit / Σ credit of log rows with date <  startDate        (opening movement)
sumdebit / sumkredit       = Σ debit / Σ credit of log rows with  startDate ≤ date ≤ endDate (period movement)

saldoawal  = isDebit ? (saldoDebitA − saldoKreditA) : (saldoKreditA − saldoDebitA)
saldoakhir = isDebit ? (sumdebit − sumkredit) + saldoawal
                     : (sumkredit − sumdebit) + saldoawal
saldodebit = sumdebit ;  saldokredit = sumkredit
```
  Dates: `startDate` at 00:00, `endDate` at `endOf('day')` (the only report that uses exact timestamps).
- **Laba/Rugi injection:** the Neraca calls `getLabaRugi` for the same period and office, then adds the result to account `32003`:
  - profit (`labarugi ≥ 0`) → `32003.saldokredit += labarugi`
  - loss → `32003.saldodebit += |labarugi|`
- **Roll-up** by `autosumNeraca` (section 4.6) to parents `11100 .. 11400, 11000, 12000, 13000, 10000, 21000, 22000, 23000, 20000, 32000, 30000`.
  - Parent debit-normal (assets): `saldoakhir = saldoawal + Σdebit − Σkredit`
  - Parent credit-normal (liab/equity): `saldoakhir = saldoawal + Σkredit − Σdebit`
- **Accounting identity the user expects:** `Aktiva (10000.saldoakhir) = Liabilitas (20000.saldoakhir) + Modal (30000.saldoakhir)`. The UI computes the Passiva total as `TOTAL LIABILITAS + 30000`.
- **Important:** the response contains all COA rows, including 4xxxxx/5xxxxx/6xxxxx. The **frontend** decides what is shown:
  - `Aktiva`: rows where `kode[0] == 1`
  - `Passiva`: rows where `kode[0] != 1` and `kode < 40000 or kode > 60000`; a synthetic row `TOTAL LIABILITAS` is spliced in before the first `3xxxx` row.

### 4.5 Laba Rugi / Perhitungan Hasil Usaha (Income Statement)
- **Endpoint:** `POST /financial-reporting/laba-rugi`
- **Scope:** only `kode_akun` with `tipe = 2` (LABARUGI).
- **Per account** (period movement only, no opening balance):

```
net = Σ debit − Σ credit              (rows in [start,end], office-filtered)
if account.isDebit   : saldodebit = net            , saldokredit = 0
else                 : saldodebit = 0 , saldokredit = Σ credit − Σ debit
```
- **Roll-up:** `autoSumDebitKredit` for 41000, 40000, 51000..55000, 50000. Parent rows sum children's `saldodebit` and `saldokredit` separately.
- **Result line (appended as the last element):**

```
saldo4 = row(40000).saldodebit + row(40000).saldokredit     // total pendapatan
saldo5 = row(50000).saldodebit + row(50000).saldokredit     // total biaya
saldo6 = row(60000).saldodebit + row(60000).saldokredit     // taksiran pajak

labarugi = saldo4 − (saldo5 + saldo6)        →  { labarugi: number }   // SHU / hasil usaha
```
- UI pops the last element into `dataTotal` and shows `TOTAL PERHITUNGAN HASIL USAHA`.
- Display title in the UI is **"Perhitungan Hasil Usaha"** (cooperative term for P&L).

### 4.6 The two roll-up helpers (`kode-akun.service.ts`)

`autoSumDebitKredit(rows)` and `autosumNeraca(rows)` build parent totals from children. **Both are hard-coded to the current COA** (explicit code ranges such as `kode >= '52001' && kode <= '52008'` using string comparison). They walk the array **backwards** so that children (higher codes) are processed before parents. Adding or renumbering an account requires code changes. In Siskop, derive the roll-up from a `parent_id` / path column instead.

### 4.7 `GET /financial-reporting/log-laporan`
Raw dump of `log_laporan` (optionally filtered by `officeId`), each row's `kodeAkunId` replaced by the full account object. One DB lookup per row (N+1).

---

## 5. Operational reports

### 5.1 Laporan Pasar (Market report)
- **Endpoint:** `POST /financial-reporting/laporan-pasar`
- **Function:** per market (pasar), customer growth and money collected/lent in the period.
- **Output per pasar:**

| Field | Formula |
|---|---|
| `namaPasar` | `pasar.nama` |
| `totalnasabah` | Σ `laporan_pasar.totalNasabah` for that pasar, **all time** (not capped by endDate) |
| `totalnasabahbaru` | Σ `laporan_pasar.totalNasabah` where `createDateTime ∈ [start,end]` |
| `totalnominalsimpanan` | Σ `simpananTransaksi.nominal` where `tipe == 1` (SETORAN), all time, plus Σ `simpananTransaksiKoreksi.nominal` |
| `totalnominalsimpananmasuk` | same, only where `createDateTime ∈ [start,end]` |
| `totalrekeningpembiayaanbaru` | count of `pembiayaanTarik` rows (disbursements) in range for nasabah of that pasar |
| `totalnominalpembiayaan` | Σ `pembiayaanTarik.nominal` in range |

- Pasar list: all pasar, or pasar of the selected office.
- **UI columns (header order is inconsistent between screen and print):** Nama Pasar, Total Nasabah, Total Nasabah Baru, Total Nominal Simpanan Masuk, Total Nominal Simpanan, Total Rekening Pembiayaan Baru, Total Nominal Pembiayaan.
- The older SQL implementation (commented out) computed opening/closing with `< startDate` / `<= endDate` windows, which is semantically cleaner than the current one.

### 5.2 Laporan Akad (Contract-type report)
- **Endpoint:** `POST /financial-reporting/laporan-akad`
- **Function:** how many accounts/transactions and how much value per akad (product contract) per office and pasar.
- **Algorithm (current "new flow"):**
  1. Take **active** `simpanan` (value = `saldoTotal`), **active** `deposito` (value = `saldoPokok`), and all `pembiayaanTarik` (value = `nominal`).
  2. Keep those whose `createDateTime ∈ [start,end]`.
  3. Map each to `{ kantor, pasar, kodeAkad, akad, totaltransaksi: 1, totalnilaitransaksi: value }`.
  4. `reduce` by key `(kantor, pasar, kodeAkad, akad)`: sum `totaltransaksi` and `totalnilaitransaksi`.
  5. Replace IDs with names, then filter by selected office name.
- **Output row:** `{ namaKantor, namaPasar, kodeAkad, namaAkad, totaltransaksi, totalnilaitransaksi }`
- **Note:** simpanan/deposito values are the **current** balance of accounts opened in range, not the transactions in range. The "transaction" count is accounts opened, not postings.
- The UI also builds a secondary summary (`nama, totalAkad, totalTransaksi, totalNilaiTransaksi`) grouped by akad.

### 5.3 Laporan Pegawai (Employee activity report)
Six endpoints; the UI combines them in one screen.

| Endpoint | Function | Source |
|---|---|---|
| `/laporan-pegawai` | All employees' activity feed | `laporan_pegawai` table filtered by date and office |
| `/laporan-pegawai-spesifik` | Feed for one employee | same, `namaPegawai = employee.nama` |
| `/laporan-pegawai-rekap` | **Rekapitulasi**: per product debit/kredit for one employee | `transaksi` of the employee |
| `/laporan-pegawai-sijaka` | Employee's deposito transactions | `transaksi.depositoSetor/Tarik` |
| `/laporan-pegawai-simpanan` | Employee's savings transactions | `transaksi.simpananTransaksi` |
| `/laporan-pegawai-pencairan-pembiayaan` | Disbursements done by employee | `transaksi.pembiayaanTarik` |
| `/laporan-pegawai-pembiayaan` | Installment status of loans the employee created | `pembiayaan` + `pembiayaanAngsuran` |

**Convention:** *Debit = money received by the employee from the customer* (setoran, angsuran, dana sosial). *Kredit = money paid out* (penarikan, pencairan).

**Rekap formulas** (rows in this order: Sijaka, Simpanan, Pokok Pembiayaan, Basil Pembiayaan, Sisa Pokok, Sisa Basil, Pencairan Pembiayaan, Dana Sosial):

```
Simpanan.debit            = Σ simpananTransaksi.nominal where tipe == SETORAN
Simpanan.kredit           = Σ ... where tipe != SETORAN
Sijaka.debit / .kredit    = Σ depositoSetor.nominal / Σ depositoTarik.nominal
Pokok Pembiayaan.debit    = Σ pembiayaanAngsuran.nominalPokok
Basil Pembiayaan.debit    = Σ pembiayaanAngsuran.nominalMarkup
Pencairan.kredit          = Σ pembiayaanTarik.nominal
Dana Sosial.debit         = pembiayaan.danaSosial          (assigned, not summed: see B8)
Sisa Pokok.kredit         = pembiayaan.sisaAngsuranPokok   (assigned, not summed)
Sisa Basil.kredit         = pembiayaan.sisaBayarMarkup     (assigned, not summed)
```
UI footer: `Σ Debit`, `Σ Kredit`, **Selisih = Σ Debit − Σ Kredit** (the net cash the employee should hand in).

**Detail tables** (each with footer totals):
- Sijaka / Simpanan: `Tanggal, Nama Pasar, Data Nasabah ("Nama (NoRek)"), Jenis Transaksi (Setoran|Penarikan), Debit, Kredit`
- Pencairan Pembiayaan: `Tanggal, Nama Pasar, Data Nasabah, Nominal Pencairan, Dana Sosial, Total` where `Total = nominal + danaSosial`
- Pembiayaan (installment status):

```
jumlahSetoran = (saldoAcc − sisaAngsuranPokok) + (markupTotal − sisaBayarMarkup)
angsPokok     = saldoAcc − sisaAngsuranPokok          // cumulative principal repaid
angsBasil     = markupTotal − sisaBayarMarkup         // cumulative margin repaid
sisaPokok     = sisaAngsuranPokok ; sisaBasil = sisaBayarMarkup
angsuranKe    = urutan of first completed installment (else first incomplete, with 0 payment)
```
  Only `status == ACCEPTED`, `isActive`, with at least one disbursement, created by the selected employee, created within the range. If nothing matches, it falls back to loans created in the **same month as the earliest loan**.

---

## 6. Dashboard (`GET /dashboard/*`, optional `officeId`)

| Endpoint | Formula |
|---|---|
| `simpanan/saldo-total` | Σ `simpanan.saldoTotal` of the office's employees' accounts (all offices: SQL `SUM`) |
| `deposito/saldo-perkiraan` | With office: Σ `saldoPokok` of **active** deposito (principal only). Without office: SQL `SUM(saldoPerkiraan)` **[inconsistent]** |
| `pembiayaan/saldo-acc` | With office: Σ `pembiayaanTarik.nominal` (**disbursed** amount). Without office: `SUM(saldoAcc)` (**approved** amount) **[inconsistent]** |
| `nasabah/jumlah-nasabah` | count of nasabah (by pasar.office) |
| `pembiayaan/jumlah-pembiayaan` | counts per pembiayaan akad (`pembiayaanCount`) |
| `simpanan/jumlah-simpanan` | counts per savings akad (`simpananCount`) |
| `deposito/jumlah-deposito` | count of deposito |
| `nasabah/percentage-male-by-nasabah` | `100 × male / total` (`jenisKelamin = 0`) |
| `nasabah/percentage-female-by-nasabah` | `100 × female / total` (`jenisKelamin = 1`) |
| `nasabah/perbandingan-jenis-kelamin-by-nasabah` | `COUNT(*) GROUP BY jenisKelamin` |

Charts: `BarChartSimpanan`, `BarChartPembiayaan`, `PieChart` (ApexCharts).

---

## 7. Cash and account-balance screens (UI-level only)

| Screen | Route | Content |
|---|---|---|
| Manajemen Kas | `/kas` | Six summary cards (10000 Aset, 20000 Liabilitas, 30000 Equity/Modal, 40000 Pendapatan, 50000 Biaya, plus one more) from `kode_akun.saldo`, then a cash-transaction table: No Kuitansi, Tanggal, Nominal, Keterangan, NIP, Nama Employee, Kantor, Debit, Kredit, Action |
| Rekap Kas | `/kas/detail` | Same columns plus Bukti Transaksi; printable as "Arus Kas" |
| Form Kas | `/kas/form-kas` | Entry form (cash in/out) that posts a `transaksi` + journal |
| Detail Saldo Akun | `/kas/detail-akun` | `GET /accounting/kode-akun/saldo-akun/detail/:id`: all accounts under one parent with `Kode Perk., Nama Akun, Debit/Kredit, Saldo` |

The `kode_akun.saldo` values come from a mutable running balance, not from `log_laporan`. A nightly cron (`23:55`, `newAutomationSum`) rolls children into parents, but only **raises** a parent's saldo when it is lower than the children's sum. These can drift away from the Neraca figures (see B9).

---

## 8. Report design (UI)

### 8.1 Shared layout (every report screen)

```
┌ page (class "pa-5 height-comp", scroll container) ───────────────────────────┐
│ ┌ FILTER CARD ─────────────────────────────────────────────────────────────┐ │
│ │ [Tanggal Awal ▾📅] [Tanggal Akhir ▾📅]  [Kantor ▾]   [Apply Filter] [↻]    │ │
│ │ *Masukkan terlebih dahulu Tanggal Awal dan Tanggal Akhir untuk menampilkan │ │
│ │  data <nama laporan>                                                       │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ RESULT CARD (shown after search) ────────────────────────────────────────┐ │
│ │ Title (text-h5, bold)                              [status ▾]  [🖨 Print] │ │
│ │ v-data-table  (dense, hide-default-footer, items-per-page = -1)            │ │
│ │  … rows …                                                                  │ │
│ │  footer row: TOTAL …                                                       │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ Empty state: centered bold text "Tidak Ada Data <Nama Laporan>"               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Behavioural rules** (copy these):
- **Date pickers:** `v-menu` + `v-date-picker`, read-only text field showing `moment().format('ll')`. `max = today`. End date is **disabled until start date is set**.
- **Kantor selector:** autocomplete with an extra first option `Semua Kantor (id = null)`. **Disabled** unless the user's role has access `all-pasar-nasabah`. Default value: the logged-in employee's own office.
- **Run:** nothing loads on mount. User must press Apply/Search; a loading flag drives the button spinner and table `loading`. Then `actionDataView = true`.
- **Reset:** clears dates, office, and hides the result card.
- **Empty state:** separate message when the request returns no rows.
- **Currency:** `formatCurrency` helper (Rp, thousand separators). Zero or missing shows `-`.
- **Role gating:** routes require `meta.requiresAuth`; office scope is by role.
- **Mobile:** separate `*Mobile.vue` components exist for some screens (kas, detail akun, etc.). The financial statements have no mobile variant.

### 8.2 Per-report table design

| Report | Columns (header text → field) | Special rendering |
|---|---|---|
| Jurnal Umum | No → id, Tanggal Input → createDateTime, Kode Akun → kode, Nama Akun → nama, Debit → debit, Kredit → kredit | Totals row |
| Jurnal Penyesuaian | Kode, Nama Akun, Debit → saldodebit, Kredit → saldokredit | Totals |
| Buku Besar | Kode, Nama Akun, Debet → saldodebit, Kredit → saldokredit | Parent rows (rolled-up) |
| Neraca | Kode Perk., Nama Perkiraan, Saldo Awal, Debet, Kredit, Saldo Akhir | **Hierarchy styling** (below); Aktiva/Passiva dropdown; synthetic TOTAL LIABILITAS row; right-aligned numbers |
| Laba Rugi | Kode, Nama Akun, Debet, Kredit | Footer: `TOTAL PERHITUNGAN HASIL USAHA` spanning 2 cols, value centred |
| Laporan Pasar | Nama Pasar + 6 metric columns (Section 5.1) | None |
| Laporan Akad | Nama Kantor, Nama Pasar, Nomor Akad, Keterangan Akad, Total Transaksi, Total Nilai Transaksi | Secondary summary by akad |
| Laporan Pegawai | Extra filters: Kantor + Pegawai (required for the detailed tables). Five stacked cards: Rekapitulasi → Sijaka → Simpanan → Pencairan Pembiayaan → Pembiayaan | Each card has its own footer: Σ Debit, Σ Kredit, Selisih |
| Rekap Kas / Manajemen Kas | See Section 7 | Summary cards on top |

**Neraca hierarchy styling** (derive style from the code's trailing zeros):
```
kode[1..4] all "0"         → level 1 (10000)  bold, pl-0
kode[1]≠0, rest "0"        → level 2 (11000)  bold, pl-3
kode[1]≠0, kode[2]≠0, rest "0" → level 3 (11100) bold, pl-6
otherwise                  → leaf            regular, pl-9
```

### 8.3 Print / PDF
- Library: **jsPDF + jspdf-autotable** via `printOut(type, name, orientation, data, user, dateAwal, dateAkhir)` in `src/helper/index.js`.
- A dedicated header array per report name ("Akad", "Pasar", "Laporan Pegawai", "Arus Kas", "Jurnal Umum", "Jurnal Penyesuaian", and so on); orientation `p` or `l`.
- Dedicated `printOutLaporanPegawai` renders the five-table employee report plus the employee name and NIP.
- Print uses `@current-items` of the data table, so it prints **what is currently visible** (respects filter and sort).
- Page chrome: logo (`logo-printout.js`), report title with office name in parentheses, period (`dateAwal – dateAkhir`), printed-by user.
- Print button: green (`#00923f`), white text, `mdi-printer` icon.

### 8.4 Visual language
- Font: **Poppins** (bundled `.ttf`).
- Cards: white, `border-radius: 8px`, shadow `6px 4px 10px rgba(0,0,0,.1)`, padding 8px 0.
- Titles: Poppins 700, ~20px; button text 14px/400; body text 16px/400 black.
- Component lib: Vuetify 2 (`dense solo` fields), icons `mdi-*`.

---

## 9. Defects and risks found (do not carry into Siskop)

| # | Where | Problem | Impact |
|---|---|---|---|
| B1 | `autosumNeraca` | Contra-assets (12007 to 12011, 13002; `isDebit=false`) feed their credit-normal `saldoawal` into the parent sum with `+=`, so accumulated depreciation **increases** 12000 and 10000 opening balances instead of reducing them | Aset tetap and total Aset overstated at opening |
| B2 | Neraca / `32003` | The 32003 row's own `saldoakhir` is computed before profit is injected into it; only the 32000/30000 parents include the profit. Also `32003.isDebit = true` while profit is credited to it | Row looks wrong; parent is right |
| B3 | Neraca opening | `saldoawal` for income/expense accounts accumulates across all prior periods; there is no year-end closing entry | Next-year P&L accounts carry old balances |
| B4 | `getLabaRugi` | `b.office.id` has no null check (Neraca/Buku Besar do check) | 500 when any ledger row has no office |
| B5 | `labarugi` formula | Tax (60000) is treated as an amount to subtract, but the JSON flags it credit-normal; its sign depends on how it is posted | Possible wrong SHU |
| B6 | Neraca / Buku Besar / Laba Rugi | Not filtered by `log_laporan.tipe`, so adjusting entries (`tipe=1`) are summed into them, while Jurnal Umum excludes them | Inconsistent between reports |
| B7 | Roll-ups | Hard-coded code ranges; string comparison for ranges | Any COA change silently breaks totals |
| B8 | Rekap Laporan Pegawai | `Dana Sosial`, `Sisa Pokok`, `Sisa Basil` use `=` inside the loop (last wins), and read the loan's **current** balance rather than period movement | Wrong when an employee disbursed more than once |
| B9 | `kode_akun.saldo` | Mutated directly with inconsistent signs per transaction type (for example Dr to 23001 does `−`, Dr to a receivable does `+`), plus a cron that only raises parents | Manajemen Kas cards can disagree with Neraca |
| B10 | Laporan Pegawai Sijaka | The "Penarikan" branch reads `depositoSetor[0].nominal` in the else, and the first branch's `jenisTransaksi` ternary can never reach the withdrawal case | Wrong debit/kredit for some Sijaka rows |
| B11 | `closeSimpanan` (penutupan rekening) | `ctkaTwo` is saved without ever being populated (the code fills `ctkaOne` twice) | One-sided journal line in `transaksi_kode_akun` |
| B12 | Dashboard | With-office vs without-office branches use different fields (see Section 6) | Totals change when you pick "Semua Kantor" |
| B13 | Laporan Akad | Counts accounts opened, uses current balance, not transactions | Misleading label |
| B14 | Bagi hasil formula | `saldoTotal / 25 × (rate/100/12)` for savings (an average-balance placeholder based on 25 working days) | Not a true average daily balance |
| B15 | Performance | Every report loads full tables with relations and filters in JS; Jurnal Umum fetches all rows then slices by date | Slow and memory-heavy as data grows |
| B16 | SQL safety | `officeId` is string-interpolated into SQL (after an existence check) | Fragile; use parameters |
| B17 | `POST /financial-reporting/query-sql` | Executes caller-supplied SQL against production with only a JWT guard | **Critical security hole** |
| B18 | `POST /financial-reporting/restore` | Inserts rows from an uploaded JSON into any named table, by string-built SQL; the type-check condition `!= 'integer' \|\| != 'numeric' \|\| ...` is always true, so every non-null value is quoted | **Critical security hole** and data-corruption risk |
| B19 | Timezones | Mixed `moment(date).format('YYYY-MM-DD')`, `endOf('day')` and Jakarta-time helpers | Edge-of-day transactions can land in the wrong period |

---

## 10. Recommendations for Siskop

### Accounting core
1. **True double-entry journal:** tables `journal_entry` (header: date, office, type, ref, posted_by) and `journal_line` (account, debit, credit). Enforce `Σdebit = Σcredit` per entry in the service and by DB constraint/trigger.
2. **Derive balances, do not store them.** Compute balances from lines (materialised view or nightly snapshot table by account/office/day). Drop the mutable `kode_akun.saldo`.
3. **COA as a tree:** `parent_id`, `level`, `normal_balance`, `report_section` (NERACA | LABARUGI), `is_contra`. All roll-ups become a generic recursive sum, with correct sign handling for contra accounts.
4. **Period close:** a year-end closing entry that moves net income into retained earnings (the 32003 equivalent). Neraca opening balances then come from the closed balance sheet and P&L resets each year.
5. **Entry types** (`UMUM`, `PENYESUAIAN`, plus `PENUTUP`): make each report state which types it includes. A reasonable default is that statements include adjusting entries; the general journal can filter.
6. **Add Trial Balance (Neraca Saldo)** and a real **Buku Besar per account** (opening balance, transaction lines, running balance). The present summary Buku Besar cannot be audited line by line.
7. Add **Arus Kas** (cash-flow statement) and **Laporan Perubahan Ekuitas**; they are standard for a koperasi.

### Reports
8. Push aggregation into SQL (`GROUP BY` with date and office predicates) or pre-aggregated daily tables; no table-wide loads.
9. Compute **Laporan Akad / Pasar / Pegawai** from the transaction tables with explicit period semantics: *opening* (`< start`), *movement* (`[start,end]`), *closing* (`≤ end`). Define each metric once, in a metric catalogue.
10. Add **portfolio quality** reports a lending cooperative needs and this system lacks: NPL / PAR aging buckets (1 to 30, 31 to 60, 61 to 90, over 90 days), collection efficiency (collected ÷ due), outstanding by akad, and a maturity schedule for deposito.
11. Add **drill-down:** click a Neraca/Laba Rugi account to its Buku Besar lines, and a line to its receipt (`noKuitansi`).
12. Add **export**: CSV/XLSX alongside PDF, and a consistent print template (logo, title, office, period, printed-by, page numbers, signature block).
13. **Comparative columns** (previous period, YoY) for Neraca and Laba Rugi.

### API and security
14. Remove `query-sql` and `restore` endpoints. If admin tooling is needed, build it behind a separate admin role, parameterised, and audited.
15. Parameterise all SQL; validate DTOs with `class-validator` (`@IsDateString`, `@IsUUID`), and reject `endDate < startDate`.
16. Enforce **office scope server-side** from the JWT, not only by disabling the dropdown in the UI.
17. Store dates in UTC, convert once at the edge to Asia/Jakarta, and use half-open ranges `[start, end + 1 day)`.
18. Use `numeric(18,2)` (or integer rupiah) instead of `double precision` for money.
19. Pagination and streaming for long lists (Jurnal Umum, Rekap Kas).

### UX (keep what works)
20. Keep the proven pattern: filter card → explicit Apply → result card with title, Print and footer totals; office dropdown with "Semua Kantor"; empty-state message; `-` for zero; bold/indented hierarchy by account level.
21. Improve: show the active filter summary in the result header, remember last filter, sticky table header and totals, quick presets (Hari ini, Bulan ini, Tahun ini), a single mobile-responsive layout instead of duplicate `*Mobile.vue` files, and a visible balance check on the Neraca (Aktiva = Liabilitas + Modal, with a warning chip when not equal).

---

## 11. Quick endpoint index

| Report | Method / path | Body |
|---|---|---|
| Jurnal Umum | POST `/financial-reporting/jurnal-umum` | start, end, officeId? |
| Jurnal Penyesuaian | POST `/financial-reporting/jurnal-penyesuaian` | start, end, officeId? |
| Buku Besar | POST `/financial-reporting/buku-besar` | start, end, officeId? |
| Neraca | POST `/financial-reporting/neraca` | start, end, officeId? |
| Laba Rugi | POST `/financial-reporting/laba-rugi` | start, end, officeId? |
| Log Laporan | GET `/financial-reporting/log-laporan?officeId=` | none |
| Laporan Pasar | POST `/financial-reporting/laporan-pasar` | start, end, officeId? |
| Laporan Akad | POST `/financial-reporting/laporan-akad` | start, end, officeId? |
| Laporan Pegawai (all) | POST `/financial-reporting/laporan-pegawai` | start, end, officeId? |
| Laporan Pegawai: spesifik / rekap / sijaka / simpanan / pencairan-pembiayaan / pembiayaan | POST `/financial-reporting/laporan-pegawai-*` | start, end, employeeId |
| Dashboard | GET `/dashboard/{simpanan\|deposito\|pembiayaan\|nasabah}/*` | `officeId?` |
| Saldo akun | GET `/accounting/kode-akun/saldo-akun/parent`, `/saldo-akun/detail/:id`, `/kode-akun/auto-sum` | none |

Source files to consult while rebuilding: `Backend/src/modules/insight/insight.service.ts` (all report logic), `Backend/src/modules/accounting/kode-akun.service.ts` (roll-ups, COA, cron), `Backend/src/data/kode_akun_versi_dua.json` (COA), `Frontend/main-end/src/components/laporan/*.vue` (screens), `Frontend/main-end/src/helper/index.js` (`printOut`, `formatCurrency`).
