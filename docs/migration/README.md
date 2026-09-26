# Migration template (Template Migrasi Saldo Awal)

`SISKOP_Template_Migrasi_v1.xlsx` is the standard file the SISKOP onboarding team fills
when converting a client's legacy export, Excel workbook or RAT PDF. The design rationale is in
[`../research/2026-09-26-client-data-migration-research.md`](../research/2026-09-26-client-data-migration-research.md).

## Sheets

| Sheet | Grain | Notes |
|---|---|---|
| `Petunjuk` | — | Workflow, fill-in rules, colour legend, column dictionary with example values |
| `Info_Koperasi` | 1 batch | Cutover date, source type, tolerance (default Rp 1), batch version |
| `Unit` | 1 row per unit | Every tenant has ≥1 `CooperativeUnit` |
| `Neraca` | 1 row per account | Opening trial balance at cutover; the control totals. Contra accounts use the opposite normal balance |
| `Produk` | 1 row per product | Maps to `SavingConfig` / `LoanConfig`; `kodeAkun` links each product to its Neraca account |
| `Anggota` | 1 row per member | `noAnggotaLama` must be unique; blank NIK = data incomplete (never invented) |
| `Simpanan` | 1 row per member × product | Balance at cutover |
| `Pembiayaan` | 1 row per active contract | `sisaPokok` reconciles to Piutang; `kodeAkunKhusus` for e.g. Piutang Macet |
| `Penyesuaian` | 1 row per named adjustment | The only way to bridge a difference; needs a reason and the approving pengurus |
| `Aset_Tetap` | 1 row per asset | Optional register |
| `Rekonsiliasi` | — | Formula-only. Row checks + per-account `Neraca = member detail + adjustments`. `STATUS BATCH` must read **SIAP DISETUJUI KLIEN** before the batch goes to the client |

Row 1 of each data sheet holds the machine column keys the importer will read. Columns
starting with `_` are formula helpers and are ignored on import. Each data sheet exports
cleanly to CSV (UTF-8, header row 1) when a CSV is needed.

## Regenerating

```bash
python3 docs/migration/build_template.py   # requires openpyxl
```

Recalculate the formulas afterwards (open and save in Excel/LibreOffice) so cached values exist.
