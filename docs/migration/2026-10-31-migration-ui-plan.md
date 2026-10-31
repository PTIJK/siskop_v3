# UI Migrasi Koperasi (Platform Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform admin mengunggah salah satu dari dua template standar (`SISKOP-Template-Migrasi-Sistem.xlsx` atau `-Laporan.xlsx`), melihat pratinjau galat dan total, lalu mengeksekusi migrasi satu transaksi, tanpa bantuan AI atau skrip manual.

**Architecture:** Modul backend baru `modules/migration` (pembaca xlsx -> validator zod per sheet -> validator lintas-sheet -> importer dalam satu `db.$transaction`) dipasang di bawah `/api/platform/migration`. Pratinjau = menjalankan importer yang sama lalu rollback; eksekusi = importer yang sama lalu commit, dengan hash file memastikan yang dieksekusi sama dengan yang dipratinjau. Frontend: satu halaman wizard 4 langkah di `/platform/migration`.

**Tech Stack:** Express 4, Prisma 5.22 (`createManyAndReturn`), zod, exceljs 4.4, multer (memory), vitest + supertest; React + TanStack Query + shadcn UI.

**Dokumen acuan:** `docs/migration/MIGRATION-FIELD-MAPPING.md` (pemetaan kolom, tetap sumber kebenaran), `docs/migration/SISKOP-Template-Migrasi-*.xlsx` (dihasilkan skrip).

---

## Keputusan yang dikunci rencana ini

| # | Keputusan | Alasan |
|---|---|---|
| D1 | **Tanpa tabel job.** Pratinjau dan eksekusi sama-sama menerima file; eksekusi wajib mengirim `fileHash` dari pratinjau dan server menghitung ulang SHA-256 file. | Tidak ada perubahan schema; menjamin file yang disetujui = file yang dieksekusi. |
| D2 | **Sinkron** (satu request) dengan batas: file <= 10 MB, <= 20.000 baris per sheet. Job asinkron = pekerjaan lanjutan bila benchmark Task 12 melewati 60 detik. | Skala koperasi umumnya < 5.000 anggota. Ukur dulu, jangan bangun antrean dini. |
| D3 | **Paket langganan tidak diimpor.** Kolom `package` dihapus dari template; paket diatur lewat halaman Koperasi yang ada setelah migrasi. | Menutup butir terbuka B1 tanpa menyentuh alur Pricing V2 dan cache entitlement. |
| D4 | **`cutoffDate` pindah ke sheet `1_Koperasi`** sebagai kolom. | Sel di sheet PETUNJUK berisi teks bebas dan rapuh dibaca mesin. |
| D5 | Jurnal "Saldo Awal Migrasi" dihitung **konsolidasi per akun** dan diposting dengan `unitId = null` (ember tidak dialokasikan, aturan 2b). Kolom `unitCode` di sheet 9 diabaikan dengan peringatan. | Jurnal otomatis simpanan/pinjaman sudah bercap unit; menghitung selisih per unit menghasilkan koreksi aneh antar-unit. Total konsolidasi tetap benar. |
| D6 | **Pratinjau tidak pernah membuat akun Firebase.** Pratinjau memakai identitas tiruan lokal; hanya eksekusi memanggil `withManagedIdentity`. | Firebase tidak ikut rollback transaksi DB. |
| D7 | Validasi baris **memakai ulang** skema zod modul yang ada (`memberFieldsSchema`, `createSavingConfigSchema`, `createLoanConfigSchema`, `slugSchema`). | Satu sumber aturan (CLAUDE.md "jangan duplikasi"). |
| D8 | Template diunduh dari backend (`GET /templates/:mode`), dibangun dari kode yang sama dengan skrip. | File di `docs/` tidak ikut ter-deploy; mencegah template dan importer berbeda versi. |
| D9 | `LoanPayment` dan riwayat transaksi tidak dimigrasi (sesuai MIGRATION-FIELD-MAPPING bagian 6). | Di luar cakupan versi 1. |

## Di luar cakupan

Job asinkron/antrean, migrasi Toko dan Pasar, impor riwayat pembayaran, penetapan paket, undo/rollback pasca-commit (pemulihan = hapus tenant lewat prosedur ops yang ada, lihat Task 12), pengiriman kredensial admin ke koperasi.

## Struktur file

| File | Tanggung jawab |
|---|---|
| `packages/types/src/migration.ts` (baru) | Tipe `MigrationMode`, `MigrationIssue`, `MigrationPreview`, `MigrationResult` |
| `packages/types/src/api.ts` (ubah) | `ErrorCode.MIGRATION_FILE_INVALID`, `MIGRATION_PREVIEW_MISMATCH` |
| `apps/backend/src/lib/errors.ts` (ubah) | status HTTP kode baru |
| `apps/backend/src/modules/migration/template.ts` (baru, pindah dari script) | `templateSheets(mode)`, `buildTemplate(mode)` |
| `apps/backend/src/modules/migration/workbook.ts` (baru) | Baca xlsx -> baris mentah per sheet, deteksi mode |
| `apps/backend/src/modules/migration/rows.ts` (baru) | Skema zod per sheet -> `ParsedData` bertipe |
| `apps/backend/src/modules/migration/validate.ts` (baru) | Validasi lintas-sheet, rekonsiliasi, total |
| `apps/backend/src/modules/migration/opening-balance.ts` (baru) | Fungsi murni hitung baris jurnal selisih |
| `apps/backend/src/modules/migration/importer.ts` (baru) | `runMigration(tx, ...)` menulis semua tabel |
| `apps/backend/src/modules/migration/service.ts` (baru) | `previewMigration`, `executeMigration` |
| `apps/backend/src/modules/migration/routes.ts` (baru) | Endpoint + multer |
| `apps/backend/src/modules/platform/routes.ts` (ubah) | `router.use("/migration", migrationRoutes())` |
| `apps/backend/src/modules/loans/service.ts` (ubah) | ekspor `assertFrequencyMethodCompatible` |
| `apps/backend/scripts/build-migration-template.ts` (ubah) | pembungkus tipis yang menulis dua file ke `docs/migration/` |
| `apps/backend/tests/migration-*.test.ts` (baru) | Pengujian per unit dan integrasi |
| `apps/frontend/src/pages/platform/PlatformMigrationPage.tsx` (baru) | Wizard |
| `apps/frontend/src/pages/platform/migration/*` (baru) | `UploadStep`, `PreviewStep`, `ResultStep`, `issues.ts` (+ test) |
| `apps/frontend/src/components/layout/nav.ts`, `nav.test.ts`, `App.tsx` (ubah) | Menu dan rute |

Perintah uji backend: `pnpm --filter @siskop/backend exec vitest run tests/<file>`. Suite penuh ~13 menit; jangan dijalankan per langkah. Test DB: lihat `CLAUDE.md` dan memory "Backend test database" (migrasi bisa tertinggal; Prisma CLI default ke `siskop_dev`).

---

## Task 1: Tipe bersama dan kode galat

**Files:**
- Create: `packages/types/src/migration.ts`
- Modify: `packages/types/src/index.ts`, `packages/types/src/api.ts`, `apps/backend/src/lib/errors.ts`

- [ ] **Step 1: Tulis tipe**

```ts
// packages/types/src/migration.ts
export type MigrationMode = "SISTEM" | "LAPORAN";

export interface MigrationIssue {
  severity: "error" | "warning";
  sheet: string;
  /** 1-based Excel row; null for sheet-level problems. */
  row: number | null;
  column: string | null;
  message: string;
}

export interface MigrationOpeningLine {
  accountCode: string;
  accountName: string;
  /** Decimal as string. */
  debit: string;
  credit: string;
}

export interface MigrationTotals {
  members: number;
  savingAccounts: number;
  /** Decimal strings keyed by SavingType (POKOK | WAJIB | SUKARELA). */
  savingBalanceByType: Record<string, string>;
  loans: number;
  loanRemainingPrincipal: string;
  trialDebit: string;
  trialCredit: string;
}

export interface MigrationPreview {
  mode: MigrationMode | null;
  fileHash: string;
  tenantName: string | null;
  slug: string | null;
  cutoffDate: string | null;
  counts: { sheet: string; rows: number }[];
  totals: MigrationTotals | null;
  openingEntry: MigrationOpeningLine[];
  issues: MigrationIssue[];
  /** True only when there is no error-severity issue. */
  canExecute: boolean;
}

export interface MigrationResult {
  tenantId: string;
  slug: string;
  counts: { sheet: string; rows: number }[];
  openingEntryNo: number | null;
  totals: MigrationTotals;
}
```

- [ ] **Step 2: Ekspor dan tambah kode galat**

`packages/types/src/index.ts`: tambahkan `export * from "./migration.js";`.
`packages/types/src/api.ts`: tepat setelah `INVALID_FILE_TYPE: "INVALID_FILE_TYPE",` tambahkan
```ts
  MIGRATION_FILE_INVALID: "MIGRATION_FILE_INVALID",
  MIGRATION_PREVIEW_MISMATCH: "MIGRATION_PREVIEW_MISMATCH",
```
`apps/backend/src/lib/errors.ts`: setelah `[ErrorCode.INVALID_FILE_TYPE]: 422,` tambahkan
```ts
  [ErrorCode.MIGRATION_FILE_INVALID]: 422,
  [ErrorCode.MIGRATION_PREVIEW_MISMATCH]: 409,
```

- [ ] **Step 3: Verifikasi**

Run: `pnpm run typecheck`
Expected: PASS tanpa galat (Record<ErrorCode, number> dan pemetaan lain lengkap; bila ada peta ErrorCode lain di frontend yang gagal, tambahkan entri yang sama).

- [ ] **Step 4: Commit**

```bash
git add packages/types apps/backend/src/lib/errors.ts
git commit -m "feat(migration): shared migration types and error codes"
```

---

## Task 2: Template jadi modul (dengan `cutoffDate`, tanpa `package`)

**Files:**
- Move: `apps/backend/scripts/build-migration-template.ts` -> `apps/backend/src/modules/migration/template.ts`
- Create: `apps/backend/scripts/build-migration-template.ts` (pembungkus baru)
- Test: `apps/backend/tests/migration-template.test.ts`

- [ ] **Step 1: Tulis test gagal**

```ts
// apps/backend/tests/migration-template.test.ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTemplate, templateSheets } from "../src/modules/migration/template.js";

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("migration template", () => {
  it("SISTEM has 9_Saldo_Awal_Jurnal and no 9_Neraca", async () => {
    const wb = await load(await buildTemplate("SISTEM"));
    expect(wb.getWorksheet("9_Saldo_Awal_Jurnal")).toBeDefined();
    expect(wb.getWorksheet("9_Neraca")).toBeUndefined();
    expect(wb.getWorksheet("8_Jadwal_Angsuran")).toBeDefined();
  });

  it("LAPORAN has 9_Neraca and no sheet 8", async () => {
    const wb = await load(await buildTemplate("LAPORAN"));
    expect(wb.getWorksheet("9_Neraca")).toBeDefined();
    expect(wb.getWorksheet("8_Jadwal_Angsuran")).toBeUndefined();
  });

  it("1_Koperasi carries cutoffDate and no package column", () => {
    const keys = templateSheets("SISTEM").find((s) => s.name === "1_Koperasi")!.cols.map((c) => c.key);
    expect(keys).toContain("cutoffDate");
    expect(keys).not.toContain("package");
  });

  it("row 1 of every data sheet holds the machine keys", async () => {
    const wb = await load(await buildTemplate("SISTEM"));
    for (const def of templateSheets("SISTEM")) {
      const header = (wb.getWorksheet(def.name)!.getRow(1).values as unknown[]).slice(1, def.cols.length + 1);
      expect(header).toEqual(def.cols.map((c) => c.key));
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-template.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Pindahkan dan ubah kode**

```bash
git mv apps/backend/scripts/build-migration-template.ts apps/backend/src/modules/migration/template.ts
```
(bila file masih untracked: `mv`). Lalu di `template.ts`:

1. Hapus impor `path`, `fileURLToPath`, konstanta `__dirname`, `outDir`, `FILES`. Ubah impor COA menjadi `import { COA_TEMPLATE } from "../../lib/coaTemplate.js";`.
2. Ekspor tipe dan fungsi: ganti `type Mode = ...` menjadi `export type Mode = MigrationMode;` dengan `import type { MigrationMode } from "@siskop/types";`. Ekspor `SheetDef`, `Col`. Ekspor `sheetsFor` sebagai `templateSheets`:
```ts
export const templateSheets = sheetsFor;
```
3. Ubah fungsi `build(mode, outFile)` menjadi pembuat workbook:
   - signature: `async function buildWorkbook(mode: Mode): Promise<ExcelJS.Workbook>`
   - ganti dua baris terakhir fungsi (`await wb.xlsx.writeFile(outFile); console.log(...)`) menjadi `return wb;`
4. Hapus loop di dasar file (`for (const mode of ["SISTEM","LAPORAN"] ...`) dan tambahkan:
```ts
export async function buildTemplate(mode: Mode): Promise<Buffer> {
  const wb = await buildWorkbook(mode);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```
5. Di `SHEETS` sheet `1_Koperasi`: hapus kolom `package` dan sisipkan, sebelum kolom `adminName`:
```ts
      { key: "cutoffDate", label: "Tanggal Cut-off", required: true, width: 18, hint: "YYYY-MM-DD. Tanggal semua saldo yang dimigrasi. Sebaiknya akhir tahun buku", example: "2025-12-31", fmt: "@" },
```
6. Di PETUNJUK ubah teks: pada `put(r++, "Tanggal Cut-off", ...)` ganti awalan kedua string `(diisi admin, format YYYY-MM-DD)` menjadi `(isi di sheet 1_Koperasi, kolom cutoffDate, format YYYY-MM-DD)`; pada langkah `["2. Isi PETUNJUK", ...]` ganti isinya menjadi `"Isi Nama Koperasi dan Disiapkan oleh pada kotak kuning di atas. Tanggal Cut-off diisi di sheet 1_Koperasi."`.

Pembungkus skrip baru:
```ts
// apps/backend/scripts/build-migration-template.ts
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemplate } from "../src/modules/migration/template.js";

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "migration");
for (const mode of ["SISTEM", "LAPORAN"] as const) {
  const file = path.join(dir, `SISKOP-Template-Migrasi-${mode === "SISTEM" ? "Sistem" : "Laporan"}.xlsx`);
  await writeFile(file, await buildTemplate(mode));
  console.log(`wrote ${file}`);
}
```

- [ ] **Step 4: Jalankan test dan skrip**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-template.test.ts`
Expected: PASS (4 test).
Run: `pnpm --filter @siskop/backend exec tsx scripts/build-migration-template.ts`
Expected: dua baris `wrote ...xlsx`.

- [ ] **Step 5: Sinkronkan dokumen pemetaan**

Di `docs/migration/MIGRATION-FIELD-MAPPING.md` bagian 3.1: hapus baris `package`, tambahkan baris `cutoffDate | (konteks impor) | tanggal cut-off semua entryDate dan disbursedAt default`. Ubah butir B1 menjadi: "Diputuskan: paket tidak diimpor; diatur lewat halaman Koperasi setelah migrasi." Di bagian 3.9 ubah kalimat tentang `unitCode`: "Kolom `unitCode` diabaikan (peringatan); jurnal selisih dihitung konsolidasi dan diposting `unitId=null`."

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/migration/template.ts apps/backend/scripts/build-migration-template.ts apps/backend/tests/migration-template.test.ts docs/migration
git commit -m "feat(migration): template builder as a module, cutoffDate column, drop package"
```

---

## Task 3: Pembaca workbook

Mengubah buffer menjadi baris mentah per sheet, mendeteksi mode, dan melaporkan masalah struktur. Tidak memvalidasi isi baris.

**Files:**
- Create: `apps/backend/src/modules/migration/workbook.ts`
- Test: `apps/backend/tests/migration-workbook.test.ts`, fixture builder `apps/backend/tests/migration-fixtures.ts`

- [ ] **Step 1: Fixture builder** (dipakai semua test berikutnya)

```ts
// apps/backend/tests/migration-fixtures.ts
import ExcelJS from "exceljs";
import { templateSheets } from "../src/modules/migration/template.js";
import type { MigrationMode } from "@siskop/types";

export type FixtureRows = Record<string, Record<string, string | number | null>[]>;

/** Builds an xlsx with the real template headers and the given data rows (row 4 onwards). */
export async function fixtureWorkbook(mode: MigrationMode, rows: FixtureRows): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const def of templateSheets(mode)) {
    const ws = wb.addWorksheet(def.name);
    ws.addRow(def.cols.map((c) => c.key));
    ws.addRow(def.cols.map((c, i) => (i === 0 ? `# ${c.label}` : null)));
    ws.addRow(def.cols.map((c, i) => (i === 0 ? `#${c.example}` : null)));
    for (const r of rows[def.name] ?? []) ws.addRow(def.cols.map((c) => r[c.key] ?? null));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const KOPERASI = {
  name: "Koperasi Uji", slug: "koperasi-uji", registrationNo: "AHU-001", address: "Jl. Uji No. 1, Surabaya",
  type: "KONVENSIONAL", cooperativeType: "KSP", cutoffDate: "2025-12-31", modalDisetor: 50000000,
  adminName: "Admin Uji", adminEmail: "admin@koperasi-uji.test"
};
export const UNIT = { unitCode: "U1", type: "KSP", name: "Simpan Pinjam" };
export const ANGGOTA = (nik: string, name: string) => ({
  fullName: name, nik, address: "Jl. Melati No. 5, Surabaya", birthPlace: "Surabaya", birthDate: "1985-03-21", occupation: "Guru"
});
export const SIMPANAN_POKOK = { code: "SP", name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "YEARLY" };
export const PINJAMAN = { code: "PJ", name: "Pinjaman Reguler", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36, installmentFrequency: "MONTHLY" };
```

- [ ] **Step 2: Test gagal**

```ts
// apps/backend/tests/migration-workbook.test.ts
import { describe, expect, it } from "vitest";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, UNIT } from "./migration-fixtures.js";

describe("readWorkbook", () => {
  it("detects SISTEM and skips # rows and blank rows", async () => {
    const buf = await fixtureWorkbook("SISTEM", {
      "1_Koperasi": [KOPERASI], "2_Unit": [UNIT],
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti"), {}]
    });
    const r = await readWorkbook(buf);
    expect(r.mode).toBe("SISTEM");
    expect(r.sheets["3_Anggota"]).toHaveLength(1);
    expect(r.sheets["3_Anggota"]![0]).toMatchObject({ row: 4, v: { nik: "3578012345670001", fullName: "Siti" } });
  });

  it("detects LAPORAN by 9_Neraca", async () => {
    const r = await readWorkbook(await fixtureWorkbook("LAPORAN", {}));
    expect(r.mode).toBe("LAPORAN");
  });

  it("rejects a non-xlsx buffer", async () => {
    await expect(readWorkbook(Buffer.from("not a zip"))).rejects.toMatchObject({ code: "MIGRATION_FILE_INVALID" });
  });

  it("flags a numeric NIK cell (Excel loses the last digits)", async () => {
    const buf = await fixtureWorkbook("SISTEM", { "3_Anggota": [{ ...ANGGOTA("x", "Siti"), nik: 3578012345670001 }] });
    const r = await readWorkbook(buf);
    expect(r.issues.some((i) => i.sheet === "3_Anggota" && i.column === "nik" && i.severity === "error")).toBe(true);
  });

  it("flags a formula cell", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("PETUNJUK");
    const ws = wb.addWorksheet("9_Neraca");
    ws.addRow(["reportName", "accountCode", "amount", "unitCode"]);
    ws.addRow(["Kas", "1-1000", { formula: "1+1", result: 2 }, null]);
    const r = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.issues.some((i) => i.sheet === "9_Neraca" && i.message.includes("rumus"))).toBe(true);
  });

  it("reports a file with both sheet 9 variants", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("9_Neraca").addRow(["reportName"]);
    wb.addWorksheet("9_Saldo_Awal_Jurnal").addRow(["accountCode"]);
    const r = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.mode).toBeNull();
    expect(r.issues.some((i) => i.sheet === "(file)")).toBe(true);
  });
});
```

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-workbook.test.ts` -> Expected: FAIL (modul tidak ada).

- [ ] **Step 3: Implementasi**

```ts
// apps/backend/src/modules/migration/workbook.ts
import ExcelJS from "exceljs";
import { ErrorCode, type MigrationIssue, type MigrationMode } from "@siskop/types";
import { AppError } from "../../lib/errors.js";
import { templateSheets } from "./template.js";

export const MAX_ROWS_PER_SHEET = 20_000;
/** Columns whose value must stay text: a numeric cell has already lost digits (NIK has 16, Excel keeps 15). */
const TEXT_ONLY = new Set(["nik"]);

export interface SheetRow {
  /** 1-based Excel row number. */
  row: number;
  v: Record<string, string | null>;
}

export interface ReadResult {
  mode: MigrationMode | null;
  sheets: Record<string, SheetRow[]>;
  issues: MigrationIssue[];
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Cell -> trimmed text. Formulas and rich values are rejected or flattened here so no later stage sees them. */
function cellText(cell: ExcelJS.Cell, sheet: string, column: string, issues: MigrationIssue[]): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return ymd(value);
  if (typeof value === "number") {
    if (TEXT_ONLY.has(column)) {
      issues.push({ severity: "error", sheet, row: Number(cell.row), column, message: "Kolom ini tersimpan sebagai angka. Ubah format kolom menjadi Teks lalu ketik ulang." });
      return null;
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "YA" : "TIDAK";
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if ("formula" in value || "sharedFormula" in value) {
    issues.push({ severity: "error", sheet, row: Number(cell.row), column, message: "Sel berisi rumus. Salin sebagai nilai (Paste Special > Values)." });
    return null;
  }
  if ("richText" in value) return value.richText.map((t) => t.text).join("").trim() || null;
  if ("text" in value) return String(value.text).trim() || null;
  return null;
}

export async function readWorkbook(buffer: Buffer): Promise<ReadResult> {
  // .xlsx is a zip: reject anything else before handing it to the parser.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File harus berformat .xlsx");
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File .xlsx tidak dapat dibaca");
  }

  const issues: MigrationIssue[] = [];
  const names = wb.worksheets.map((w) => w.name);
  const hasSistem = names.includes("9_Saldo_Awal_Jurnal");
  const hasLaporan = names.includes("9_Neraca");
  let mode: MigrationMode | null = null;
  if (hasSistem && hasLaporan) {
    issues.push({ severity: "error", sheet: "(file)", row: null, column: null, message: "File memuat 9_Saldo_Awal_Jurnal dan 9_Neraca sekaligus. Gunakan satu template saja." });
  } else if (!hasSistem && !hasLaporan) {
    issues.push({ severity: "error", sheet: "(file)", row: null, column: null, message: "Sheet 9_Saldo_Awal_Jurnal atau 9_Neraca tidak ditemukan. Pakai template resmi." });
  } else {
    mode = hasSistem ? "SISTEM" : "LAPORAN";
  }

  const sheets: Record<string, SheetRow[]> = {};
  const expected = new Map((mode ? templateSheets(mode) : []).map((d) => [d.name, d]));
  for (const ws of wb.worksheets) {
    if (ws.name === "PETUNJUK" || ws.name.startsWith("Referensi_")) continue;
    const def = expected.get(ws.name);
    if (!def) {
      issues.push({ severity: "warning", sheet: ws.name, row: null, column: null, message: "Sheet tidak dikenal untuk template ini dan diabaikan." });
      continue;
    }
    if (ws.rowCount > MAX_ROWS_PER_SHEET + 3) {
      issues.push({ severity: "error", sheet: ws.name, row: null, column: null, message: `Maksimal ${MAX_ROWS_PER_SHEET} baris per sheet.` });
      continue;
    }
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => (typeof h === "string" ? h.trim() : ""));
    for (const c of def.cols) {
      if (c.required && !header.includes(c.key)) {
        issues.push({ severity: "error", sheet: ws.name, row: 1, column: c.key, message: "Kolom wajib tidak ada di baris judul. Jangan ubah baris 1 template." });
      }
    }
    const rows: SheetRow[] = [];
    ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      if (rowNumber === 1) return;
      const first = excelRow.getCell(1).value;
      if (typeof first === "string" && first.trim().startsWith("#")) return;
      const v: Record<string, string | null> = {};
      header.forEach((key, i) => {
        if (key) v[key] = cellText(excelRow.getCell(i + 1), ws.name, key, issues);
      });
      if (Object.values(v).every((x) => x === null)) return;
      rows.push({ row: rowNumber, v });
    });
    sheets[ws.name] = rows;
  }
  for (const def of expected.values()) {
    if (def.required && (sheets[def.name]?.length ?? 0) === 0 && !issues.some((i) => i.sheet === def.name && i.severity === "error")) {
      issues.push({ severity: "error", sheet: def.name, row: null, column: null, message: "Sheet wajib ini kosong." });
    }
  }
  return { mode, sheets, issues };
}
```

- [ ] **Step 4: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-workbook.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/workbook.ts apps/backend/tests/migration-workbook.test.ts apps/backend/tests/migration-fixtures.ts
git commit -m "feat(migration): xlsx workbook reader with mode detection"
```

---

## Task 4: Validasi baris dan `ParsedData`

Memetakan baris mentah ke tipe bertipe memakai skema zod yang sudah ada (D7). Menerapkan nilai default template Laporan (bagian 3.11.1 mapping).

**Files:**
- Modify: `apps/backend/src/modules/loans/service.ts` (ekspor `assertFrequencyMethodCompatible`, ubah `function` menjadi `export function` pada baris 36)
- Create: `apps/backend/src/modules/migration/rows.ts`
- Test: `apps/backend/tests/migration-rows.test.ts`

- [ ] **Step 1: Test gagal**

```ts
// apps/backend/tests/migration-rows.test.ts
import { describe, expect, it } from "vitest";
import { parseRows } from "../src/modules/migration/rows.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const base = {
  "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN]
};
async function parse(mode: "SISTEM" | "LAPORAN", rows: Record<string, Record<string, string | number | null>[]>) {
  return parseRows(await readWorkbook(await fixtureWorkbook(mode, { ...base, ...rows })));
}

describe("parseRows", () => {
  it("reports short NIK with sheet, row and column", async () => {
    const { issues } = await parse("SISTEM", { "3_Anggota": [ANGGOTA("123", "Siti")] });
    expect(issues).toContainEqual(expect.objectContaining({ sheet: "3_Anggota", row: 4, column: "nik", severity: "error" }));
  });

  it("parses SISTEM loans with Decimal money and keeps given values", async () => {
    const { data, issues } = await parse("SISTEM", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "7_Pinjaman": [{ loanRef: "L-1", nik: "3578012345670001", productCode: "PJ", principalAmount: 10000000, totalAmount: 11200000,
        remainingAmount: 7466667, remainingPrincipal: 6666667, termMonths: 12, installmentAmount: 933333.33, disbursedAt: "2025-03-15" }]
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    const loan = data!.loans[0]!;
    expect(loan.remainingPrincipal.toString()).toBe("6666667");
    expect(loan.estimated).toBe(false);
    expect(loan.disbursedAt).toBe("2025-03-15");
  });

  it("LAPORAN loans get substitute values and an estimate flag", async () => {
    const { data } = await parse("LAPORAN", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "7_Pinjaman": [{ loanRef: "L-1", nik: "3578012345670001", productCode: "PJ", remainingPrincipal: 6000000, termMonths: 6 }]
    });
    const loan = data!.loans[0]!;
    expect(loan.remainingAmount.toString()).toBe("6000000");
    expect(loan.principalAmount.toString()).toBe("6000000");
    expect(loan.totalAmount.toString()).toBe("6000000");
    expect(loan.disbursedAt).toBe("2025-12-31");
    expect(loan.estimated).toBe(true);
    expect(loan.notes).toMatch(/^Migrasi dari laporan RAT: tenor dan tanggal cair estimasi\./);
  });

  it("rejects money with more than 2 decimals", async () => {
    const { issues } = await parse("SISTEM", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "5_Saldo_Simpanan": [{ nik: "3578012345670001", productCode: "SP", balance: 100.123 }]
    });
    expect(issues).toContainEqual(expect.objectContaining({ sheet: "5_Saldo_Simpanan", column: "balance" }));
  });
});
```

Run -> Expected: FAIL (modul tidak ada).

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/rows.ts
import { Prisma } from "@prisma/client";
import { z, type ZodTypeAny } from "zod";
import { CooperativeType, type MigrationIssue, type MigrationMode } from "@siskop/types";
import { memberFieldsSchema } from "../members/schema.js";
import { createLoanConfigSchema } from "../loans/schema.js";
import { createSavingConfigSchema } from "../savings/schema.js";
import { slugSchema } from "../tenants/provision.js";
import type { ReadResult, SheetRow } from "./workbook.js";

const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Angka dengan maksimal 2 desimal, tanpa 'Rp' atau titik ribuan").transform((v) => new Prisma.Decimal(v));
const moneyOpt = money.optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD");
const yn = z.enum(["YA", "TIDAK"]).transform((v) => v === "YA");
const int = z.coerce.number().int();

export const koperasiRow = z.object({
  name: z.string().min(1), slug: slugSchema, registrationNo: z.string().min(1), address: z.string().min(1),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]), cooperativeType: z.string().min(1).default("KSP"),
  cutoffDate: ymd, modalDisetor: moneyOpt, adminName: z.string().min(1), adminEmail: z.string().email()
});
export const unitRow = z.object({ unitCode: z.string().min(1), type: z.nativeEnum(CooperativeType), name: z.string().min(1) });
export const memberRow = memberFieldsSchema.extend({
  legacyNo: z.string().optional(), isPengurus: yn.default("TIDAK"), isPengawas: yn.default("TIDAK"),
  commodity: z.string().optional(), isActive: yn.default("YA"), unitCode: z.string().optional()
});
export const savingProductRow = createSavingConfigSchema.extend({ code: z.string().min(1) });
export const savingBalanceRow = z.object({ nik: z.string().min(1), productCode: z.string().min(1), balance: money, unitCode: z.string().optional() });
export const loanProductRow = createLoanConfigSchema.extend({ code: z.string().min(1) });

const loanCommon = {
  loanRef: z.string().min(1), nik: z.string().min(1), productCode: z.string().min(1),
  remainingPrincipal: money, termMonths: int.min(1), kolCategory: z.enum(["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"]).default("LANCAR"),
  notes: z.string().optional(), unitCode: z.string().optional(), installmentAmount: moneyOpt
};
export const loanRowSistem = z.object({
  ...loanCommon, principalAmount: money, totalAmount: money, remainingAmount: money, disbursedAt: ymd,
  installmentFrequency: z.enum(["MONTHLY", "WEEKLY", "DAILY"]).default("MONTHLY"), installmentCount: int.min(1).optional(),
  rate: z.coerce.number().min(0).max(100).optional(), status: z.enum(["ACTIVE", "COMPLETED", "DEFAULTED"]).default("ACTIVE"),
  daysOverdue: int.min(0).default(0)
});
export const loanRowLaporan = z.object({ ...loanCommon, remainingAmount: moneyOpt });
export const scheduleRow = z.object({
  loanRef: z.string().min(1), seq: int.min(1), dueDate: ymd, principalDue: money, interestDue: money,
  principalPaid: money.default("0"), interestPaid: money.default("0"), paidOffAt: ymd.optional()
});
export const trialRowSistem = z.object({ accountCode: z.string().min(1), debit: moneyOpt, credit: moneyOpt, unitCode: z.string().optional() });
export const trialRowLaporan = z.object({ reportName: z.string().min(1), accountCode: z.string().min(1), amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Angka dengan maksimal 2 desimal").transform((v) => new Prisma.Decimal(v)), unitCode: z.string().optional() });
export const extraAccountRow = z.object({
  code: z.string().min(1), name: z.string().min(1), category: z.enum(["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN"]),
  normalBalance: z.enum(["DEBIT", "KREDIT"]), parentCode: z.string().optional(), isCashEquivalent: yn.default("TIDAK")
});

type WithRow<T> = T & { _row: number };
export interface LoanRow {
  _row: number; loanRef: string; nik: string; productCode: string; unitCode?: string;
  principalAmount: Prisma.Decimal; totalAmount: Prisma.Decimal; remainingAmount: Prisma.Decimal; remainingPrincipal: Prisma.Decimal;
  termMonths: number; installmentAmount: Prisma.Decimal | null; disbursedAt: string;
  installmentFrequency: "MONTHLY" | "WEEKLY" | "DAILY"; installmentCount?: number; rate?: number;
  status: "ACTIVE" | "COMPLETED" | "DEFAULTED"; kolCategory: string; daysOverdue: number; notes: string | null;
  /** True when plafon/tanggal cair/total are substitutes derived from a report. */
  estimated: boolean;
}
export type MemberRow = WithRow<z.infer<typeof memberRow>>;
export type TrialRow = WithRow<{ accountCode: string; reportName?: string; debit?: Prisma.Decimal; credit?: Prisma.Decimal; amount?: Prisma.Decimal }>;

export interface ParsedData {
  mode: MigrationMode;
  koperasi: WithRow<z.infer<typeof koperasiRow>>;
  units: WithRow<z.infer<typeof unitRow>>[];
  members: MemberRow[];
  savingProducts: WithRow<z.infer<typeof savingProductRow>>[];
  savings: WithRow<z.infer<typeof savingBalanceRow>>[];
  loanProducts: WithRow<z.infer<typeof loanProductRow>>[];
  loans: LoanRow[];
  schedule: WithRow<z.infer<typeof scheduleRow>>[];
  trial: TrialRow[];
  extraAccounts: WithRow<z.infer<typeof extraAccountRow>>[];
}

function parseSheet<S extends ZodTypeAny>(sheet: string, rows: SheetRow[] | undefined, schema: S, issues: MigrationIssue[]): WithRow<z.infer<S>>[] {
  const out: WithRow<z.infer<S>>[] = [];
  for (const r of rows ?? []) {
    // Null cells become undefined so zod defaults and optionals apply.
    const clean = Object.fromEntries(Object.entries(r.v).filter(([, x]) => x !== null));
    const res = schema.safeParse(clean);
    if (res.success) out.push({ ...(res.data as object), _row: r.row } as WithRow<z.infer<S>>);
    else for (const i of res.error.issues) issues.push({ severity: "error", sheet, row: r.row, column: String(i.path[0] ?? "") || null, message: i.message });
  }
  return out;
}

export function parseRows(read: ReadResult): { data: ParsedData | null; issues: MigrationIssue[] } {
  const issues = [...read.issues];
  if (!read.mode) return { data: null, issues };
  const s = read.sheets;
  const koperasi = parseSheet("1_Koperasi", s["1_Koperasi"], koperasiRow, issues);
  if ((s["1_Koperasi"]?.length ?? 0) > 1) issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: null, message: "Hanya boleh 1 baris data." });
  const cutoff = koperasi[0]?.cutoffDate ?? "";

  const loans: LoanRow[] = read.mode === "SISTEM"
    ? parseSheet("7_Pinjaman", s["7_Pinjaman"], loanRowSistem, issues).map((l) => ({
        ...l, installmentAmount: l.installmentAmount ?? null, notes: l.notes ?? null, estimated: false
      }))
    : parseSheet("7_Pinjaman", s["7_Pinjaman"], loanRowLaporan, issues).map((l) => {
        const remainingAmount = l.remainingAmount ?? l.remainingPrincipal;
        return {
          ...l, principalAmount: remainingAmount, totalAmount: remainingAmount, remainingAmount, disbursedAt: cutoff,
          installmentFrequency: "MONTHLY" as const, status: "ACTIVE" as const, daysOverdue: 0, installmentAmount: l.installmentAmount ?? null,
          notes: ["Migrasi dari laporan RAT: tenor dan tanggal cair estimasi.", l.notes].filter(Boolean).join(" "), estimated: true
        };
      });

  const trial: TrialRow[] = read.mode === "SISTEM"
    ? parseSheet("9_Saldo_Awal_Jurnal", s["9_Saldo_Awal_Jurnal"], trialRowSistem, issues)
    : parseSheet("9_Neraca", s["9_Neraca"], trialRowLaporan, issues);

  if (issues.some((i) => i.severity === "error" && ["1_Koperasi", "2_Unit"].includes(i.sheet)) && koperasi.length === 0) return { data: null, issues };
  return {
    issues,
    data: {
      mode: read.mode, koperasi: koperasi[0]!, units: parseSheet("2_Unit", s["2_Unit"], unitRow, issues),
      members: parseSheet("3_Anggota", s["3_Anggota"], memberRow, issues),
      savingProducts: parseSheet("4_Produk_Simpanan", s["4_Produk_Simpanan"], savingProductRow, issues),
      savings: parseSheet("5_Saldo_Simpanan", s["5_Saldo_Simpanan"], savingBalanceRow, issues),
      loanProducts: parseSheet("6_Produk_Pinjaman", s["6_Produk_Pinjaman"], loanProductRow, issues),
      loans, schedule: read.mode === "SISTEM" ? parseSheet("8_Jadwal_Angsuran", s["8_Jadwal_Angsuran"], scheduleRow, issues) : [],
      trial, extraAccounts: parseSheet("10_Akun_Tambahan", s["10_Akun_Tambahan"], extraAccountRow, issues)
    }
  };
}
```

Catatan: pada `parseSheet` untuk `trialRowSistem` nilai `unitCode` bila terisi diberi peringatan di Task 5 (D5).

- [ ] **Step 3: Ekspor fungsi loans** — di `apps/backend/src/modules/loans/service.ts:36` ubah `function assertFrequencyMethodCompatible(` menjadi `export function assertFrequencyMethodCompatible(`.

- [ ] **Step 4: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-rows.test.ts && pnpm run typecheck`
Expected: PASS, typecheck bersih. (Bila `memberFieldsSchema.extend` gagal tipe karena skema itu `ZodObject` dengan efek, gunakan `.merge(z.object({...}))`.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/rows.ts apps/backend/src/modules/loans/service.ts apps/backend/tests/migration-rows.test.ts
git commit -m "feat(migration): row schemas reuse module validators; report-mode loan defaults"
```

---

## Task 5: Validasi lintas-sheet, rekonsiliasi, total

**Files:**
- Create: `apps/backend/src/modules/migration/validate.ts`
- Test: `apps/backend/tests/migration-validate.test.ts`

- [ ] **Step 1: Test gagal**

```ts
// apps/backend/tests/migration-validate.test.ts
import { describe, expect, it } from "vitest";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
async function run(extra: Record<string, Record<string, string | number | null>[]>, mode: "SISTEM" | "LAPORAN" = "SISTEM") {
  const read = await readWorkbook(await fixtureWorkbook(mode, {
    "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN],
    "3_Anggota": [ANGGOTA(NIK1, "Siti")], "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }], ...extra
  }));
  const parsed = parseRows(read);
  return { ...validateData(parsed.data!), parseIssues: parsed.issues };
}
const errors = (r: { issues: { severity: string; message: string }[] }) => r.issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("validateData", () => {
  it("passes a balanced SISTEM trial balance and totals it", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [
      { accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 100000 }] });
    expect(errors(r)).toEqual([]);
    expect(r.totals.trialDebit).toBe("100000");
    expect(r.totals.savingBalanceByType.POKOK).toBe("100000");
  });

  it("rejects an unbalanced trial balance", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 90000 }] });
    expect(errors(r).join(" ")).toMatch(/tidak seimbang/);
  });

  it("rejects an unknown account code and a header account", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "9-9999", debit: 1 }, { accountCode: "1-2000", credit: 1 }] });
    expect(errors(r).filter((m) => /akun/i.test(m)).length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a duplicate NIK and a saving row for an unknown NIK", async () => {
    const r = await run({ "3_Anggota": [ANGGOTA(NIK1, "Siti"), ANGGOTA(NIK1, "Siti Dua")], "5_Saldo_Simpanan": [{ nik: "1111111111111111", productCode: "SP", balance: 1 }] });
    expect(errors(r).join(" ")).toMatch(/NIK ganda/);
    expect(errors(r).join(" ")).toMatch(/tidak ada di 3_Anggota/);
  });

  it("rejects a loan for a member without a POKOK saving", async () => {
    const r = await run({
      "5_Saldo_Simpanan": [],
      "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", principalAmount: 1000, totalAmount: 1100, remainingAmount: 500, remainingPrincipal: 400, termMonths: 3, disbursedAt: "2025-06-01" }],
      "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 1 }, { accountCode: "3-1000", credit: 1 }]
    });
    expect(errors(r).join(" ")).toMatch(/simpanan pokok/i);
  });

  it("warns when saving subledger differs from the trial balance account", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 50000 }, { accountCode: "3-1000", credit: 50000 }] });
    expect(r.issues.some((i) => i.severity === "warning" && /rekonsiliasi/i.test(i.message))).toBe(true);
  });

  it("LAPORAN: positive amount follows normal balance, so a KREDIT-normal contra account balances", async () => {
    const r = await run({ "9_Neraca": [
      { reportName: "Kas", accountCode: "1-1000", amount: 1000 },
      { reportName: "Piutang", accountCode: "1-1100", amount: 500 },
      { reportName: "Penyisihan", accountCode: "1-1190", amount: 100 },
      { reportName: "Simpanan Pokok", accountCode: "3-1000", amount: 1400 }] }, "LAPORAN");
    expect(errors(r)).toEqual([]);
    expect(r.totals.trialDebit).toBe("1500");
    expect(r.totals.trialCredit).toBe("1500");
  });

  it("LAPORAN: a loan sheet with no remaining tenor is a parse error", async () => {
    const r = await run({ "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", remainingPrincipal: 1000 }], "9_Neraca": [] }, "LAPORAN");
    expect(r.parseIssues.some((i) => i.sheet === "7_Pinjaman" && i.column === "termMonths")).toBe(true);
  });
});
```

Run -> Expected: FAIL.

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/validate.ts
import { Prisma } from "@prisma/client";
import type { MigrationIssue, MigrationTotals } from "@siskop/types";
import { COA_TEMPLATE } from "../../lib/coaTemplate.js";
import { validateRegulatoryRate } from "../../lib/regulatory-config.js";
import { assertFrequencyMethodCompatible } from "../loans/service.js";
import type { ParsedData } from "./rows.js";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface AccountInfo { code: string; name: string; normalBalance: "DEBIT" | "KREDIT"; isHeader: boolean }

/** Standard COA the new tenant will get (unit-gated accounts only if the unit exists) plus sheet 10. */
export function accountIndex(data: ParsedData): Map<string, AccountInfo> {
  const types = new Set(data.units.map((u) => u.type));
  const index = new Map<string, AccountInfo>();
  for (const a of COA_TEMPLATE) {
    if (a.unitType && !types.has(a.unitType)) continue;
    if (a.multiUnitOnly && data.units.length <= 1) continue;
    index.set(a.code, { code: a.code, name: a.name, normalBalance: a.normalBalance, isHeader: !!a.isHeader });
  }
  for (const a of data.extraAccounts) index.set(a.code, { code: a.code, name: a.name, normalBalance: a.normalBalance, isHeader: false });
  return index;
}

/** Target balance per account as debit minus credit (positive = net debit). Unknown accounts are skipped; validateData reports them. */
export function targetNet(data: ParsedData, index: Map<string, AccountInfo>): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  for (const t of data.trial) {
    const acct = index.get(t.accountCode);
    if (!acct) continue;
    let net: Prisma.Decimal;
    if (t.amount !== undefined) net = acct.normalBalance === "DEBIT" ? t.amount : t.amount.neg();
    else net = (t.debit ?? ZERO).sub(t.credit ?? ZERO);
    out.set(t.accountCode, (out.get(t.accountCode) ?? ZERO).add(net));
  }
  return out;
}

const SAVING_ACCOUNT: Record<string, string> = { POKOK: "3-1000", WAJIB: "3-1100", SUKARELA: "2-1000" };

export function validateData(data: ParsedData): { issues: MigrationIssue[]; totals: MigrationTotals } {
  const issues: MigrationIssue[] = [];
  const err = (sheet: string, row: number | null, column: string | null, message: string) => issues.push({ severity: "error", sheet, row, column, message });
  const warn = (sheet: string, row: number | null, column: string | null, message: string) => issues.push({ severity: "warning", sheet, row, column, message });

  const cutoff = data.koperasi.cutoffDate;
  const unitCodes = new Set<string>();
  for (const u of data.units) {
    if (unitCodes.has(u.unitCode)) err("2_Unit", u._row, "unitCode", `Kode unit ganda: ${u.unitCode}`);
    unitCodes.add(u.unitCode);
  }
  const unitRef = (sheet: string, row: number, code?: string) => { if (code && !unitCodes.has(code)) err(sheet, row, "unitCode", `Kode unit ${code} tidak ada di 2_Unit`); };

  const niks = new Map<string, number>();
  for (const m of data.members) {
    if (niks.has(m.nik)) err("3_Anggota", m._row, "nik", `NIK ganda (juga di baris ${niks.get(m.nik)})`);
    niks.set(m.nik, m._row);
    unitRef("3_Anggota", m._row, m.unitCode);
  }

  const savingTypeByCode = new Map<string, string>();
  for (const p of data.savingProducts) {
    if (savingTypeByCode.has(p.code)) err("4_Produk_Simpanan", p._row, "code", `Kode produk ganda: ${p.code}`);
    savingTypeByCode.set(p.code, p.type);
    try { validateRegulatoryRate("SAVING", p.rate); } catch (e) { err("4_Produk_Simpanan", p._row, "rate", (e as Error).message); }
  }
  const loanProducts = new Map(data.loanProducts.map((p) => [p.code, p]));
  for (const p of data.loanProducts) {
    try { validateRegulatoryRate("LOAN", p.rate); assertFrequencyMethodCompatible(p); } catch (e) { err("6_Produk_Pinjaman", p._row, "rate", (e as Error).message); }
  }

  const pokokNik = new Set<string>();
  const seenSaving = new Set<string>();
  const savingByType: Record<string, Prisma.Decimal> = { POKOK: ZERO, WAJIB: ZERO, SUKARELA: ZERO };
  for (const s of data.savings) {
    if (!niks.has(s.nik)) err("5_Saldo_Simpanan", s._row, "nik", `NIK ${s.nik} tidak ada di 3_Anggota`);
    const type = savingTypeByCode.get(s.productCode);
    if (!type) err("5_Saldo_Simpanan", s._row, "productCode", `Kode produk ${s.productCode} tidak ada di 4_Produk_Simpanan`);
    if (s.balance.isNeg()) err("5_Saldo_Simpanan", s._row, "balance", "Saldo tidak boleh negatif");
    const key = `${s.nik}|${s.productCode}`;
    if (seenSaving.has(key)) err("5_Saldo_Simpanan", s._row, "productCode", "Pasangan NIK dan kode produk ganda");
    seenSaving.add(key);
    unitRef("5_Saldo_Simpanan", s._row, s.unitCode);
    if (type) { savingByType[type] = savingByType[type]!.add(s.balance); if (type === "POKOK") pokokNik.add(s.nik); }
  }

  const loanRefs = new Set<string>();
  const memberByNik = new Map(data.members.map((m) => [m.nik, m]));
  let principalSum = ZERO;
  const pengurusPrincipal = new Map<string, Prisma.Decimal>();
  for (const l of data.loans) {
    if (loanRefs.has(l.loanRef)) err("7_Pinjaman", l._row, "loanRef", `Kode pinjaman ganda: ${l.loanRef}`);
    loanRefs.add(l.loanRef);
    if (!niks.has(l.nik)) err("7_Pinjaman", l._row, "nik", `NIK ${l.nik} tidak ada di 3_Anggota`);
    else if (!pokokNik.has(l.nik)) err("7_Pinjaman", l._row, "nik", "Anggota belum punya simpanan pokok di 5_Saldo_Simpanan");
    if (!loanProducts.has(l.productCode)) err("7_Pinjaman", l._row, "productCode", `Kode produk ${l.productCode} tidak ada di 6_Produk_Pinjaman`);
    if (l.remainingPrincipal.gt(l.remainingAmount)) err("7_Pinjaman", l._row, "remainingPrincipal", "Sisa pokok melebihi sisa kewajiban");
    if (l.remainingAmount.gt(l.totalAmount)) err("7_Pinjaman", l._row, "remainingAmount", "Sisa kewajiban melebihi total kewajiban awal");
    if (l.status === "COMPLETED" && !l.remainingAmount.isZero()) err("7_Pinjaman", l._row, "status", "Pinjaman COMPLETED harus bersisa 0");
    if (l.status !== "COMPLETED" && l.remainingPrincipal.lte(0)) err("7_Pinjaman", l._row, "remainingPrincipal", "Pinjaman berjalan harus punya sisa pokok > 0");
    if (l.disbursedAt > cutoff) err("7_Pinjaman", l._row, "disbursedAt", "Tanggal cair melewati tanggal cut-off");
    unitRef("7_Pinjaman", l._row, l.unitCode);
    principalSum = principalSum.add(l.remainingPrincipal);
    const m = memberByNik.get(l.nik);
    if (m && (m.isPengurus || m.isPengawas)) pengurusPrincipal.set(l.nik, (pengurusPrincipal.get(l.nik) ?? ZERO).add(l.principalAmount));
    if (l.estimated) warn("7_Pinjaman", l._row, null, "Tenor, tanggal cair, dan plafon adalah estimasi dari laporan.");
  }
  const modal = data.koperasi.modalDisetor;
  if (modal && !modal.isZero()) {
    for (const [nik, sum] of pengurusPrincipal) {
      if (sum.gt(modal.mul("0.1"))) warn("7_Pinjaman", null, "principalAmount", `Pinjaman pengurus/pengawas NIK ${nik} melebihi 10% Modal Disetor (Permenkop UKM 8/2023)`);
    }
  }

  // Schedule (SISTEM): one entry per loan must reach remainingPrincipal.
  const byLoan = new Map<string, typeof data.schedule>();
  for (const s of data.schedule) {
    if (!loanRefs.has(s.loanRef)) { err("8_Jadwal_Angsuran", s._row, "loanRef", `Kode pinjaman ${s.loanRef} tidak ada di 7_Pinjaman`); continue; }
    byLoan.set(s.loanRef, [...(byLoan.get(s.loanRef) ?? []), s]);
  }
  for (const [ref, rows] of byLoan) {
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    if (seqs.some((q, i) => q !== i + 1)) err("8_Jadwal_Angsuran", rows[0]!._row, "seq", `Angsuran ${ref} harus berurutan 1..n tanpa lompat atau ganda`);
    const loan = data.loans.find((l) => l.loanRef === ref)!;
    const owed = rows.reduce((a, r) => a.add(r.principalDue.sub(r.principalPaid)), ZERO);
    if (!owed.eq(loan.remainingPrincipal)) err("8_Jadwal_Angsuran", rows[0]!._row, "principalDue", `Sisa pokok jadwal ${owed} tidak sama dengan sisa pokok pinjaman ${loan.remainingPrincipal}`);
    for (const r of rows) if (r.principalPaid.gt(r.principalDue) || r.interestPaid.gt(r.interestDue)) err("8_Jadwal_Angsuran", r._row, "principalPaid", "Terbayar melebihi tagihan");
  }

  // Trial balance / neraca.
  const index = accountIndex(data);
  const sheet = data.mode === "SISTEM" ? "9_Saldo_Awal_Jurnal" : "9_Neraca";
  for (const t of data.trial) {
    const acct = index.get(t.accountCode);
    if (!acct) err(sheet, t._row, "accountCode", `Akun ${t.accountCode} tidak ada di COA standar atau 10_Akun_Tambahan`);
    else if (acct.isHeader) err(sheet, t._row, "accountCode", `Akun ${t.accountCode} adalah akun induk dan tidak bisa dijurnal`);
    if (data.mode === "SISTEM" && t.debit && t.credit && !t.debit.isZero() && !t.credit.isZero()) err(sheet, t._row, "debit", "Isi salah satu: debit atau kredit");
    if ("unitCode" in t && (t as { unitCode?: string }).unitCode) warn(sheet, t._row, "unitCode", "Kolom unitCode diabaikan; saldo awal diposting di tingkat koperasi.");
  }
  const target = targetNet(data, index);
  let debit = ZERO, credit = ZERO;
  for (const v of target.values()) (v.gte(0) ? (debit = debit.add(v)) : (credit = credit.add(v.neg())));
  if (!debit.eq(credit)) err(sheet, null, null, `Neraca saldo tidak seimbang: debit ${debit} kredit ${credit} (selisih ${debit.sub(credit)})`);

  for (const [type, code] of Object.entries(SAVING_ACCOUNT)) {
    const sub = savingByType[type]!;
    const gl = (target.get(code) ?? ZERO).neg();
    if (!sub.isZero() && !sub.eq(gl)) warn(sheet, null, null, `Rekonsiliasi: total simpanan ${type} di 5_Saldo_Simpanan ${sub} berbeda dari akun ${code} di sheet 9 (${gl})`);
  }
  const piutang = target.get("1-1100") ?? ZERO;
  if (!principalSum.isZero() && !principalSum.eq(piutang)) warn(sheet, null, null, `Rekonsiliasi: total sisa pokok pinjaman ${principalSum} berbeda dari akun 1-1100 di sheet 9 (${piutang})`);

  return {
    issues,
    totals: {
      members: data.members.length, savingAccounts: data.savings.length,
      savingBalanceByType: Object.fromEntries(Object.entries(savingByType).map(([k, v]) => [k, v.toString()])),
      loans: data.loans.length, loanRemainingPrincipal: principalSum.toString(), trialDebit: debit.toString(), trialCredit: credit.toString()
    }
  };
}
```

- [ ] **Step 3: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-validate.test.ts && pnpm run typecheck`
Expected: PASS (8 test). Bila test "header account" gagal karena `1-2000` tidak `isHeader` di template, periksa `COA_TEMPLATE` (kode 1-2000 `Aset Tetap` memang `isHeader: true`).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/migration/validate.ts apps/backend/tests/migration-validate.test.ts
git commit -m "feat(migration): cross-sheet validation, reconciliation warnings, totals"
```

---

## Task 6: Hitungan jurnal selisih (fungsi murni)

**Files:**
- Create: `apps/backend/src/modules/migration/opening-balance.ts`
- Test: `apps/backend/tests/migration-opening-balance.test.ts`

- [ ] **Step 1: Test gagal**

```ts
// apps/backend/tests/migration-opening-balance.test.ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { openingLines } from "../src/modules/migration/opening-balance.js";

const m = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, new Prisma.Decimal(v)]));

describe("openingLines", () => {
  it("posts only the difference between target and auto journals", () => {
    // target: Kas 1000 debit, Simpanan 1000 credit. Auto already did Kas +300 debit, Simpanan 300 credit.
    const lines = openingLines(m({ kas: "1000", simp: "-1000" }), m({ kas: "300", simp: "-300" }));
    expect(lines).toEqual([
      { key: "kas", debit: new Prisma.Decimal(700), credit: new Prisma.Decimal(0) },
      { key: "simp", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(700) }
    ]);
  });

  it("reverses an auto balance the target does not mention", () => {
    const lines = openingLines(m({ simp: "-100" }), m({ kas: "100", simp: "-100" }));
    expect(lines).toContainEqual({ key: "kas", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100) });
  });

  it("returns nothing when target equals auto", () => {
    expect(openingLines(m({ kas: "5", simp: "-5" }), m({ kas: "5", simp: "-5" }))).toEqual([]);
  });

  it("throws when the result would not balance", () => {
    expect(() => openingLines(m({ kas: "10" }), m({}))).toThrow(/tidak seimbang/);
  });
});
```

Run -> Expected: FAIL.

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/opening-balance.ts
import { Prisma } from "@prisma/client";

export interface OpeningLine { key: string; debit: Prisma.Decimal; credit: Prisma.Decimal }

/**
 * Both maps are net balances per account (debit minus credit). The migration posts only
 * target - auto, so what the saving/loan postings already wrote is never counted twice.
 */
export function openingLines(target: Map<string, Prisma.Decimal>, auto: Map<string, Prisma.Decimal>): OpeningLine[] {
  const keys = new Set([...target.keys(), ...auto.keys()]);
  const lines: OpeningLine[] = [];
  let sum = new Prisma.Decimal(0);
  for (const key of [...keys].sort()) {
    const delta = (target.get(key) ?? new Prisma.Decimal(0)).sub(auto.get(key) ?? new Prisma.Decimal(0));
    if (delta.isZero()) continue;
    sum = sum.add(delta);
    lines.push({ key, debit: delta.gt(0) ? delta : new Prisma.Decimal(0), credit: delta.lt(0) ? delta.neg() : new Prisma.Decimal(0) });
  }
  if (!sum.isZero()) throw new Error(`Jurnal saldo awal tidak seimbang (selisih ${sum})`);
  return lines;
}
```

- [ ] **Step 3: Jalankan, commit**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-opening-balance.test.ts` -> PASS (4 test).
```bash
git add apps/backend/src/modules/migration/opening-balance.ts apps/backend/tests/migration-opening-balance.test.ts
git commit -m "feat(migration): opening-balance delta calculation"
```

---

## Task 7: Importer (jalur SISTEM)

`runMigration(tx, data, ctx)` menulis semua tabel. Satu fungsi, dipakai pratinjau dan eksekusi. Tes integrasi memakai database uji.

**Files:**
- Create: `apps/backend/src/modules/migration/importer.ts`
- Test: `apps/backend/tests/migration-importer.test.ts`

- [ ] **Step 1: Test gagal** (skenario SISTEM penuh)

```ts
// apps/backend/tests/migration-importer.test.ts
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { runMigration } from "../src/modules/migration/importer.js";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const NIK2 = "3578012345670002";

async function parsed(mode: "SISTEM" | "LAPORAN", rows: Record<string, Record<string, string | number | null>[]>) {
  const p = parseRows(await readWorkbook(await fixtureWorkbook(mode, rows)));
  expect(validateData(p.data!).issues.filter((i) => i.severity === "error")).toEqual([]);
  return p.data!;
}
const identity = () => ({ id: randomUUID(), email: "admin@koperasi-uji.test", passwordHash: "x", firebaseUid: null, authProvider: null });
const ctx = { adminUserId: "" };

beforeEach(async () => { await db.tenant.deleteMany({}); });

describe("runMigration (SISTEM)", () => {
  it("creates tenant, members, savings, loan and one balanced opening entry", async () => {
    const data = await parsed("SISTEM", {
      "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN],
      "3_Anggota": [ANGGOTA(NIK1, "Siti"), ANGGOTA(NIK2, "Budi")],
      "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 500000 }, { nik: NIK2, productCode: "SP", balance: 500000 }],
      "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", principalAmount: 6000000, totalAmount: 6720000, remainingAmount: 3360000,
        remainingPrincipal: 3000000, termMonths: 12, installmentAmount: 560000, disbursedAt: "2025-07-01" }],
      "9_Saldo_Awal_Jurnal": [
        { accountCode: "1-1000", debit: 2000000 }, { accountCode: "1-1100", debit: 3000000 },
        { accountCode: "3-1000", credit: 1000000 }, { accountCode: "3-2000", credit: 4000000 }]
    });
    const result = await db.$transaction((tx) => runMigration(tx, data, { identity: identity(), requestId: "t", actorUserId: null }), { timeout: 60_000 });

    const tenant = await withoutTenantScope(() => db.tenant.findUniqueOrThrow({ where: { slug: "koperasi-uji" } }));
    expect(result.tenantId).toBe(tenant.id);
    expect(await db.member.count({ where: { tenantId: tenant.id } })).toBe(2);
    expect(await db.saving.count({ where: { tenantId: tenant.id } })).toBe(2);
    expect(await db.loanInstallment.count({ where: { tenantId: tenant.id } })).toBeGreaterThan(0);

    const loan = await db.loan.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(loan.remainingAmount.toString()).toBe("3360000");
    expect(loan.status).toBe("ACTIVE");

    // Trial balance in the ledger now equals the sheet, per account, and debit == credit overall.
    const lines = await db.journalLine.groupBy({ by: ["accountId"], where: { tenantId: tenant.id }, _sum: { debit: true, credit: true } });
    const accounts = await db.account.findMany({ where: { tenantId: tenant.id } });
    const net = (code: string) => {
      const a = accounts.find((x) => x.code === code)!;
      const l = lines.find((x) => x.accountId === a.id);
      return new Prisma.Decimal(l?._sum.debit ?? 0).sub(l?._sum.credit ?? 0).toString();
    };
    expect(net("1-1000")).toBe("2000000");
    expect(net("1-1100")).toBe("3000000");
    expect(net("3-1000")).toBe("-1000000");
    expect(net("3-2000")).toBe("-4000000");
    const total = await db.journalLine.aggregate({ where: { tenantId: tenant.id }, _sum: { debit: true, credit: true } });
    expect(total._sum.debit!.toString()).toBe(total._sum.credit!.toString());
  });

  it("makes the first sheet-2 unit the default unit", async () => {
    const data = await parsed("SISTEM", {
      "1_Koperasi": [KOPERASI], "2_Unit": [UNIT, { unitCode: "U2", type: "KONSUMEN", name: "Toko" }],
      "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN], "3_Anggota": [ANGGOTA(NIK1, "Siti")],
      "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 1 }, { accountCode: "3-1000", credit: 1 }]
    });
    const r = await db.$transaction((tx) => runMigration(tx, data, { identity: identity(), requestId: "t", actorUserId: null }), { timeout: 60_000 });
    const { getDefaultUnitId } = await import("../src/lib/units.js");
    const def = await db.cooperativeUnit.findUniqueOrThrow({ where: { id: await getDefaultUnitId(r.tenantId) } });
    expect(def.name).toBe("Simpan Pinjam");
  });
});
```

Run -> Expected: FAIL (modul tidak ada).

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/importer.ts
import { Prisma } from "@prisma/client";
import type { MigrationOpeningLine, MigrationResult } from "@siskop/types";
import type { TxClient } from "../../lib/db.js";
import { buildSchedule } from "../../lib/installment-schedule.js";
import { createJournalEntry, postLoanDisbursement, postSavingTransaction } from "../../lib/journal.js";
import { loadOperatingCalendar, parseDateKey } from "../../lib/operating-calendar.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { recordAudit } from "../audit-log/service.js";
import { generateStandardCoaInTx } from "../config/service.js";
import { provisionTenantInTx } from "../tenants/provision.js";
import { accountIndex, targetNet } from "./validate.js";
import { openingLines } from "./opening-balance.js";
import type { ParsedData } from "./rows.js";

export interface MigrationContext {
  /** User fields for the first admin (id, email, passwordHash, ...). Preview passes a local stub. */
  identity: { id: string; email: string; passwordHash: string | null; firebaseUid: string | null; authProvider: string | null };
  requestId: string;
  /** The platform admin running the migration; recorded on the audit row. */
  actorUserId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ImportOutcome extends MigrationResult {
  opening: MigrationOpeningLine[];
}

const cutoffDate = (s: string) => parseDateKey(s);
const chunks = <T,>(xs: T[], n = 1000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function runMigration(tx: TxClient, data: ParsedData, ctx: MigrationContext): Promise<ImportOutcome> {
  const k = data.koperasi;
  const cutoff = cutoffDate(k.cutoffDate);
  const slugUpper = k.slug.toUpperCase();

  // 1. Tenant, units, roles, standard COA.
  const { tenant, roles } = await provisionTenantInTx(tx, {
    name: k.name, slug: k.slug, registrationNo: k.registrationNo, address: k.address, type: k.type, cooperativeType: k.cooperativeType,
    firstUnit: { type: data.units[0]!.type, name: data.units[0]!.name },
    additionalUnits: data.units.slice(1).map((u) => ({ type: u.type, name: u.name }))
  });
  const tenantId = tenant.id;
  if (k.modalDisetor) await tx.tenant.update({ where: { id: tenantId }, data: { modalDisetor: k.modalDisetor } });

  // createMany stamps every unit with the same now(); getDefaultUnitId orders by createdAt, so stagger them
  // in sheet order to make the first sheet-2 unit the default.
  const unitRows = await tx.cooperativeUnit.findMany({ where: { tenantId } });
  const unitIds = new Map<string, string>();
  const base = Date.now();
  for (const [i, u] of data.units.entries()) {
    const row = unitRows.find((r) => r.name === u.name && r.type === u.type)!;
    await tx.cooperativeUnit.update({ where: { id: row.id }, data: { createdAt: new Date(base + i) } });
    unitIds.set(u.unitCode, row.id);
  }
  const defaultUnitId = unitIds.get(data.units[0]!.unitCode)!;
  const unitOf = (code?: string) => (code ? unitIds.get(code)! : defaultUnitId);

  // 2. First admin.
  const superAdmin = roles.find((r) => r.name === "Super Admin")!;
  const admin = await tx.user.create({ data: { tenantId, roleId: superAdmin.id, name: k.adminName, ...ctx.identity } });

  // 3. Extra accounts, then products, then mappings (mappings need both).
  const byCode = new Map((await tx.account.findMany({ where: { tenantId } })).map((a) => [a.code, a.id]));
  for (const a of data.extraAccounts) {
    const created = await tx.account.create({
      data: { tenantId, code: a.code, name: a.name, category: a.category, normalBalance: a.normalBalance, isCashEquivalent: a.isCashEquivalent, parentId: a.parentCode ? byCode.get(a.parentCode) : undefined }
    });
    byCode.set(a.code, created.id);
  }
  const savingConfigIds = new Map<string, string>();
  for (const p of data.savingProducts) {
    const c = await tx.savingConfig.create({ data: { tenantId, name: p.name, type: p.type, rateType: p.rateType, rate: p.rate, periodUnit: p.periodUnit, isDefault: false, isActive: true } });
    savingConfigIds.set(p.code, c.id);
  }
  const loanConfigIds = new Map<string, string>();
  for (const p of data.loanProducts) {
    const c = await tx.loanConfig.create({
      data: { tenantId, name: p.name, type: p.type, rateType: p.rateType, rate: p.rate, maxTermMonths: p.maxTermMonths, installmentFrequency: p.installmentFrequency, maxInstallments: p.maxInstallments, isActive: true }
    });
    loanConfigIds.set(p.code, c.id);
  }
  await generateStandardCoaInTx(tx, tenantId);

  // 4. Members. memberId is numbered in memory: generateMemberId counts rows in the DB per call.
  const yyyymm = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
  const accountNumbers = await uniqueAccountNumbers(tx, data.members.length);
  const memberIds = new Map<string, string>();
  for (const [ci, chunk] of chunks(data.members).entries()) {
    const created = await tx.member.createManyAndReturn({
      data: chunk.map((m, i) => ({
        tenantId, memberId: `KOP-${slugUpper}-${yyyymm}-${String(ci * 1000 + i + 1).padStart(4, "0")}`, accountNumber: accountNumbers[ci * 1000 + i]!,
        fullName: m.fullName, nik: m.nik, address: m.address, birthPlace: m.birthPlace, birthDate: new Date(m.birthDate), occupation: m.occupation,
        isActive: m.isActive, isPengurus: m.isPengurus, isPengawas: m.isPengawas, commodity: m.commodity ?? null
      })),
      select: { id: true, nik: true }
    });
    for (const c of created) memberIds.set(c.nik, c.id);
    await tx.unitMembership.createMany({ data: chunk.map((m) => ({ memberId: memberIds.get(m.nik)!, unitId: unitOf(m.unitCode) })) });
  }

  // 5. Savings: balance, one DEPOSIT, one journal entry each (same path createSaving uses).
  for (const s of data.savings) {
    const unitId = unitOf(s.unitCode);
    const saving = await tx.saving.create({ data: { tenantId, unitId, memberId: memberIds.get(s.nik)!, savingConfigId: savingConfigIds.get(s.productCode)!, balance: s.balance, isActive: true } });
    if (s.balance.gt(0)) {
      const txn = await tx.savingTransaction.create({
        data: { savingId: saving.id, tenantId, type: "DEPOSIT", amount: s.balance, note: "Saldo awal migrasi", createdBy: admin.id, createdAt: cutoff }
      });
      await postSavingTransaction(tx, {
        tenantId, unitId, savingTransactionId: txn.id, savingConfigId: saving.savingConfigId, kind: "DEPOSIT",
        amount: s.balance, entryDate: cutoff, description: "Saldo awal simpanan (migrasi)"
      });
    }
  }

  // 6. Loans.
  const calendar = await loadOperatingCalendar(tx, tenantId);
  const configs = new Map(data.loanProducts.map((p) => [p.code, p]));
  const scheduleByRef = Map.groupBy(data.schedule, (s) => s.loanRef);
  for (const l of data.loans) {
    const unitId = unitOf(l.unitCode);
    const disbursedAt = cutoffDate(l.disbursedAt);
    const given = scheduleByRef.get(l.loanRef);
    const installments = given
      ? given.map((g) => ({ seq: g.seq, dueDate: cutoffDate(g.dueDate), principalDue: g.principalDue, interestDue: g.interestDue, principalPaid: g.principalPaid, interestPaid: g.interestPaid, paidOffAt: g.paidOffAt ? cutoffDate(g.paidOffAt) : null }))
      : l.status === "COMPLETED"
        ? []
        : buildSchedule({ principal: l.remainingPrincipal, totalAmount: l.remainingAmount, frequency: "MONTHLY", count: l.termMonths, disbursedAt: cutoff, calendar })
            .map((s) => ({ ...s, principalPaid: new Prisma.Decimal(0), interestPaid: new Prisma.Decimal(0), paidOffAt: null as Date | null }));
    const last = installments[installments.length - 1];
    const product = configs.get(l.productCode)!;
    const loan = await tx.loan.create({
      data: {
        tenantId, unitId, memberId: memberIds.get(l.nik)!, loanConfigId: loanConfigIds.get(l.productCode)!,
        principalAmount: l.principalAmount, totalAmount: l.totalAmount, termMonths: l.termMonths,
        monthlyPayment: l.installmentAmount ?? (installments[0] ? installments[0].principalDue.add(installments[0].interestDue) : new Prisma.Decimal(0)),
        remainingAmount: l.remainingAmount, status: l.status, kolCategory: l.kolCategory as never, daysOverdue: l.daysOverdue, disbursedAt,
        installmentFrequency: l.installmentFrequency, installmentCount: l.installmentFrequency === "MONTHLY" ? null : (l.installmentCount ?? null),
        installmentAmount: l.installmentAmount ?? installments[0]?.principalDue.add(installments[0].interestDue) ?? null,
        rate: l.rate ?? product.rate, rateNote: l.rate !== undefined && l.rate !== product.rate ? "Migrasi: tarif sistem lama" : null,
        notes: l.notes, maturityDate: last?.dueDate ?? null
      }
    });
    if (installments.length > 0) {
      await tx.loanInstallment.createMany({
        data: installments.map((s) => ({
          tenantId, loanId: loan.id, seq: s.seq, dueDate: s.dueDate, principalDue: s.principalDue, interestDue: s.interestDue,
          principalPaid: s.principalPaid, interestPaid: s.interestPaid, paidOffAt: s.paidOffAt,
          status: s.principalPaid.add(s.interestPaid).gte(s.principalDue.add(s.interestDue)) ? "PAID" : s.principalPaid.add(s.interestPaid).gt(0) ? "PARTIAL" : "UNPAID"
        }))
      });
    }
    if (l.status !== "COMPLETED" && l.remainingPrincipal.gt(0)) {
      await postLoanDisbursement(tx, {
        tenantId, unitId, loanId: loan.id, loanConfigId: loan.loanConfigId, amount: l.remainingPrincipal, entryDate: cutoff, description: "Saldo awal pinjaman (migrasi)"
      });
    }
  }

  // 7. Opening entry = target trial balance minus what steps 5-6 already journaled.
  const index = accountIndex(data);
  const target = new Map<string, Prisma.Decimal>();
  for (const [code, net] of targetNet(data, index)) target.set(byCode.get(code)!, net);
  const auto = new Map<string, Prisma.Decimal>();
  const posted = await tx.journalLine.findMany({ where: { tenantId }, select: { accountId: true, debit: true, credit: true } });
  for (const p of posted) auto.set(p.accountId, (auto.get(p.accountId) ?? new Prisma.Decimal(0)).add(p.debit).sub(p.credit));
  const lines = openingLines(target, auto);
  const codeById = new Map([...byCode].map(([c, id]) => [id, c]));
  let openingEntryNo: number | null = null;
  if (lines.length > 0) {
    const entry = await createJournalEntry(tx, {
      tenantId, unitId: null, entryDate: cutoff, sourceType: "MANUAL", sourceId: null, description: "Saldo Awal Migrasi",
      createdById: admin.id, lines: lines.map((l) => ({ accountId: l.key, debit: l.debit, credit: l.credit }))
    });
    openingEntryNo = entry.entryNo;
  }

  await recordAudit(tx, {
    action: "tenant.migrate", entityType: "Tenant", entityId: tenantId,
    after: { mode: data.mode, cutoffDate: k.cutoffDate, members: data.members.length, savings: data.savings.length, loans: data.loans.length, openingEntryNo }
  }, { tenantId, actorUserId: ctx.actorUserId, requestId: ctx.requestId, ip: ctx.ip, userAgent: ctx.userAgent });

  const names = new Map((await tx.account.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const counts = [
    { sheet: "Anggota", rows: data.members.length }, { sheet: "Rekening simpanan", rows: data.savings.length },
    { sheet: "Pinjaman", rows: data.loans.length }, { sheet: "Jurnal saldo awal (baris)", rows: lines.length }
  ];
  return {
    tenantId, slug: tenant.slug, counts, openingEntryNo,
    totals: { members: data.members.length, savingAccounts: data.savings.length, savingBalanceByType: {}, loans: data.loans.length, loanRemainingPrincipal: "0", trialDebit: "0", trialCredit: "0" },
    opening: lines.map((l) => ({ accountCode: codeById.get(l.key)!, accountName: names.get(l.key) ?? "", debit: l.debit.toString(), credit: l.credit.toString() }))
  };
}

/** ACC-{10 digits}, unique across all tenants; the check must see every tenant's members. */
async function uniqueAccountNumbers(tx: TxClient, n: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < n) {
    const batch = new Set<string>();
    while (out.size + batch.size < n) batch.add(`ACC-${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`);
    const taken = await withoutTenantScope(() => tx.member.findMany({ where: { accountNumber: { in: [...batch] } }, select: { accountNumber: true } }));
    const takenSet = new Set(taken.map((t) => t.accountNumber));
    for (const a of batch) if (!takenSet.has(a) && !out.has(a)) out.add(a);
  }
  return [...out];
}
```

Catatan untuk pelaksana: `ImportOutcome.totals` diisi ulang oleh service (Task 9) dari `validateData(...).totals`; nilai nol di atas hanya penampung tipe. Bila `Map.groupBy` tidak tersedia di Node 22 target TS, ganti dengan loop pengelompokan manual.

- [ ] **Step 3: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-importer.test.ts`
Expected: PASS (2 test). Bila guard `tenant-scope` melempar pada kueri tertentu, tambahkan `tenantId` pada `where` kueri itu; **jangan** membungkus seluruh importer dengan `withoutTenantScope`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/migration/importer.ts apps/backend/tests/migration-importer.test.ts
git commit -m "feat(migration): importer writes tenant, members, savings, loans and opening entry"
```

---

## Task 8: Importer (jalur LAPORAN)

Jalur yang sama dengan Task 7 sudah menangani `mode: "LAPORAN"` lewat `ParsedData` yang dinormalisasi di Task 4 (pinjaman pengganti, `targetNet` memakai `amount` dan saldo normal akun). Task ini hanya membuktikannya.

**Files:**
- Test: `apps/backend/tests/migration-importer-laporan.test.ts`

- [ ] **Step 1: Test**

```ts
// apps/backend/tests/migration-importer-laporan.test.ts
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { runMigration } from "../src/modules/migration/importer.js";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
beforeEach(async () => { await db.tenant.deleteMany({}); });

describe("runMigration (LAPORAN)", () => {
  it("builds an estimated schedule from the remaining balance and balances the neraca", async () => {
    const p = parseRows(await readWorkbook(await fixtureWorkbook("LAPORAN", {
      "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN],
      "3_Anggota": [ANGGOTA(NIK1, "Siti")], "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 1000000 }],
      "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", remainingPrincipal: 600000, remainingAmount: 660000, termMonths: 6 }],
      "9_Neraca": [
        { reportName: "Kas", accountCode: "1-1000", amount: 900000 }, { reportName: "Piutang", accountCode: "1-1100", amount: 600000 },
        { reportName: "Penyisihan", accountCode: "1-1190", amount: 100000 }, { reportName: "Simpanan Pokok", accountCode: "3-1000", amount: 1000000 },
        { reportName: "Cadangan", accountCode: "3-2000", amount: 400000 }]
    })));
    expect(validateData(p.data!).issues.filter((i) => i.severity === "error")).toEqual([]);

    const r = await db.$transaction((tx) => runMigration(tx, p.data!, { identity: { id: randomUUID(), email: "a@b.test", passwordHash: "x", firebaseUid: null, authProvider: null }, requestId: "t", actorUserId: null }), { timeout: 60_000 });

    const loan = await db.loan.findFirstOrThrow({ where: { tenantId: r.tenantId } });
    expect(loan.notes).toMatch(/estimasi/);
    expect(loan.disbursedAt!.toISOString().slice(0, 10)).toBe("2025-12-31");
    const inst = await db.loanInstallment.findMany({ where: { loanId: loan.id }, orderBy: { seq: "asc" } });
    expect(inst).toHaveLength(6);
    expect(inst.reduce((a, i) => a.add(i.principalDue), new Prisma.Decimal(0)).toString()).toBe("600000");
    expect(inst.reduce((a, i) => a.add(i.interestDue), new Prisma.Decimal(0)).toString()).toBe("60000");

    const total = await db.journalLine.aggregate({ where: { tenantId: r.tenantId }, _sum: { debit: true, credit: true } });
    expect(total._sum.debit!.toString()).toBe(total._sum.credit!.toString());
    const acct = await db.account.findFirstOrThrow({ where: { tenantId: r.tenantId, code: "1-1190" } });
    const pen = await db.journalLine.aggregate({ where: { tenantId: r.tenantId, accountId: acct.id }, _sum: { debit: true, credit: true } });
    expect(pen._sum.credit!.toString()).toBe("100000");
  });
});
```

- [ ] **Step 2: Jalankan; perbaiki sumber bila gagal**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-importer-laporan.test.ts`
Expected: PASS. Jika gagal pada jumlah bunga jadwal, periksa `buildSchedule` di `lib/installment-schedule.ts` (sisa pembulatan masuk angsuran terakhir) dan sesuaikan ekspektasi hanya bila perilaku bawaannya terbukti benar.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/migration-importer-laporan.test.ts
git commit -m "test(migration): report-mode importer builds estimated schedule and balanced opening entry"
```

---

## Task 9: Service pratinjau dan eksekusi

**Files:**
- Create: `apps/backend/src/modules/migration/service.ts`
- Test: `apps/backend/tests/migration-service.test.ts`

- [ ] **Step 1: Test gagal**

```ts
// apps/backend/tests/migration-service.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { executeMigration, previewMigration } from "../src/modules/migration/service.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const rows = {
  "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN],
  "3_Anggota": [ANGGOTA(NIK1, "Siti")], "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }],
  "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 100000 }]
};
const actor = { userId: "platform-admin-1", requestId: "r1", ip: null, userAgent: null };
const tenants = () => withoutTenantScope(() => db.tenant.count({ where: { slug: "koperasi-uji" } }));

beforeEach(async () => { await db.tenant.deleteMany({}); });

describe("previewMigration", () => {
  it("writes nothing and returns counts, totals and the opening entry", async () => {
    const p = await previewMigration(await fixtureWorkbook("SISTEM", rows));
    expect(p.canExecute).toBe(true);
    expect(p.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.counts.find((c) => c.sheet === "3_Anggota")?.rows).toBe(1);
    expect(await tenants()).toBe(0);
  });

  it("reports errors and refuses execute when the file is invalid", async () => {
    const p = await previewMigration(await fixtureWorkbook("SISTEM", { ...rows, "3_Anggota": [ANGGOTA("12", "X")] }));
    expect(p.canExecute).toBe(false);
    expect(p.issues.some((i) => i.sheet === "3_Anggota" && i.column === "nik")).toBe(true);
  });

  it("reports a clash with an existing tenant slug", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor });
    const again = await previewMigration(buf);
    expect(again.canExecute).toBe(false);
    expect(again.issues.some((i) => i.sheet === "1_Koperasi" && i.column === "slug")).toBe(true);
  });
});

describe("executeMigration", () => {
  it("commits the tenant when the hash matches and logs tenant.migrate", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const result = await executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor });
    expect(result.slug).toBe("koperasi-uji");
    expect(await tenants()).toBe(1);
    const audit = await db.auditLog.findFirst({ where: { tenantId: result.tenantId, action: "tenant.migrate" } });
    expect(audit?.actorUserId).toBe("platform-admin-1");
  });

  it("rejects a different file than the previewed one", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await expect(executeMigration(buf, { fileHash: "0".repeat(64), adminPassword: "Rahasia123", actor }))
      .rejects.toMatchObject({ code: "MIGRATION_PREVIEW_MISMATCH" });
    expect(await tenants()).toBe(0);
  });

  it("rolls back everything when the file has errors", async () => {
    const buf = await fixtureWorkbook("SISTEM", { ...rows, "3_Anggota": [ANGGOTA("12", "X")] });
    await expect(executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await tenants()).toBe(0);
  });

  it("rejects a short admin password", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await expect(executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "short", actor }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
```

Catatan: kolom `AuditLog.actorUserId` adalah FK ke `User`; bila FK menolak id fiktif `platform-admin-1`, ganti fixture dengan `createPlatformAdminSession()` dari `tests/helpers.ts` dan pakai `session.user.id`.

Run -> Expected: FAIL.

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/service.ts
import { createHash, randomUUID } from "node:crypto";
import { ErrorCode, type MigrationPreview, type MigrationResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { withManagedIdentity } from "../identity-provisioning/service.js";
import { runMigration, type ImportOutcome } from "./importer.js";
import { parseRows, type ParsedData } from "./rows.js";
import { validateData } from "./validate.js";
import { readWorkbook } from "./workbook.js";

/** Thrown inside the preview transaction to force the rollback; carries what the dry run produced. */
class DryRun extends Error {
  constructor(readonly outcome: ImportOutcome) { super("dry run"); }
}

const TX = { timeout: 10 * 60 * 1000, maxWait: 30_000 } as const;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export interface Actor { userId: string; requestId: string; ip?: string | null; userAgent?: string | null }

async function analyse(buffer: Buffer) {
  const read = await readWorkbook(buffer);
  const parsed = parseRows(read);
  const checked = parsed.data ? validateData(parsed.data) : null;
  const issues = [...parsed.issues, ...(checked?.issues ?? [])];
  if (parsed.data) {
    const k = parsed.data.koperasi;
    const clash = await withoutTenantScope(() => db.tenant.findFirst({ where: { OR: [{ slug: k.slug }, { registrationNo: k.registrationNo }] }, select: { slug: true, registrationNo: true } }));
    if (clash?.slug === k.slug) issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: "slug", message: `Subdomain ${k.slug} sudah dipakai koperasi lain` });
    if (clash && clash.slug !== k.slug && clash.registrationNo === k.registrationNo) issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: "registrationNo", message: "Nomor badan hukum sudah terdaftar" });
    const email = await withoutTenantScope(() => db.user.findFirst({ where: { email: k.adminEmail.toLowerCase() }, select: { id: true } }));
    if (email) issues.push({ severity: "warning", sheet: "1_Koperasi", row: null, column: "adminEmail", message: "Email ini sudah punya akun di koperasi lain; akun baru tetap dibuat untuk koperasi ini." });
  }
  return { read, data: parsed.data, totals: checked?.totals ?? null, issues };
}

export async function previewMigration(buffer: Buffer): Promise<MigrationPreview> {
  const a = await analyse(buffer);
  const hasError = a.issues.some((i) => i.severity === "error");
  let opening: ImportOutcome["opening"] = [];
  if (a.data && !hasError) {
    try {
      await db.$transaction(async (tx) => {
        const outcome = await runMigration(tx, a.data!, {
          identity: { id: randomUUID(), email: a.data!.koperasi.adminEmail.toLowerCase(), passwordHash: null, firebaseUid: null, authProvider: null },
          requestId: "migration-preview", actorUserId: null
        });
        throw new DryRun(outcome);
      }, TX);
    } catch (e) {
      if (e instanceof DryRun) opening = e.outcome.opening;
      else throw e;
    }
  }
  return {
    mode: a.read.mode, fileHash: sha256(buffer), tenantName: a.data?.koperasi.name ?? null, slug: a.data?.koperasi.slug ?? null,
    cutoffDate: a.data?.koperasi.cutoffDate ?? null,
    counts: Object.entries(a.read.sheets).map(([sheet, rows]) => ({ sheet, rows: rows.length })),
    totals: a.totals, openingEntry: opening, issues: a.issues, canExecute: !hasError && a.data !== null
  };
}

export async function executeMigration(buffer: Buffer, input: { fileHash: string; adminPassword: string; actor: Actor }): Promise<MigrationResult> {
  if (sha256(buffer) !== input.fileHash) throw new AppError(ErrorCode.MIGRATION_PREVIEW_MISMATCH, "File berbeda dari yang dipratinjau. Unggah dan pratinjau ulang.");
  if (input.adminPassword.length < 8) throw new AppError(ErrorCode.VALIDATION_ERROR, "Kata sandi admin minimal 8 karakter");
  const a = await analyse(buffer);
  if (!a.data || a.issues.some((i) => i.severity === "error")) throw new AppError(ErrorCode.VALIDATION_ERROR, "File masih memuat kesalahan. Jalankan pratinjau dan perbaiki.");

  const data: ParsedData = a.data;
  const outcome = await withManagedIdentity(
    { email: data.koperasi.adminEmail, name: data.koperasi.adminName, password: input.adminPassword },
    (identity, tx) => runMigration(tx, data, { identity, requestId: input.actor.requestId, actorUserId: input.actor.userId, ip: input.actor.ip, userAgent: input.actor.userAgent })
  );
  return { tenantId: outcome.tenantId, slug: outcome.slug, counts: outcome.counts, openingEntryNo: outcome.openingEntryNo, totals: a.totals! };
}
```

- [ ] **Step 3: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-service.test.ts && pnpm run typecheck`
Expected: PASS. Bila `withManagedIdentity` memakai transaksi bawaan dengan timeout default 5 detik, tambahkan opsi timeout pada `persist` di `identity-provisioning/service.ts:88` (`db.$transaction(fn, { timeout: 10 * 60 * 1000 })`) dan lapor di commit; jalur Firebase (`identityProvisioner.create`) diperiksa pada Task 12.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/migration/service.ts apps/backend/tests/migration-service.test.ts apps/backend/src/modules/identity-provisioning
git commit -m "feat(migration): preview (dry run) and execute with file-hash guard"
```

---

## Task 10: Rute dan keamanan

**Files:**
- Create: `apps/backend/src/modules/migration/routes.ts`
- Modify: `apps/backend/src/modules/platform/routes.ts`
- Test: `apps/backend/tests/migration-routes.test.ts`

- [ ] **Step 1: Test gagal**

```ts
// apps/backend/tests/migration-routes.test.ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const rows = {
  "1_Koperasi": [KOPERASI], "2_Unit": [UNIT], "4_Produk_Simpanan": [SIMPANAN_POKOK], "6_Produk_Pinjaman": [PINJAMAN],
  "3_Anggota": [ANGGOTA(NIK1, "Siti")], "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }],
  "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 100000 }]
};
const P = "/api/platform/migration";
let token: string;
beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret"; process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  token = (await createPlatformAdminSession()).accessToken;
});

describe("platform migration routes", () => {
  it("requires auth", async () => {
    expect((await request(app()).post(`${P}/preview`)).status).toBe(401);
  });

  it("forbids a tenant admin", async () => {
    const t = await setupTenant();
    const res = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${t.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("serves both templates", async () => {
    for (const mode of ["sistem", "laporan"]) {
      const res = await request(app()).get(`${P}/templates/${mode}`).set("Authorization", `Bearer ${token}`).buffer().parse((r, cb) => { const c: Buffer[] = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("spreadsheetml");
    }
    expect((await request(app()).get(`${P}/templates/xx`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });

  it("previews then executes, returning the ApiResponse envelope", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", buf, "migrasi.xlsx");
    expect(pre.status).toBe(200);
    expect(pre.body.success).toBe(true);
    expect(pre.body.data.canExecute).toBe(true);
    const exec = await request(app()).post(`${P}/execute`).set("Authorization", `Bearer ${token}`)
      .field("fileHash", pre.body.data.fileHash).field("adminPassword", "Rahasia123").attach("file", buf, "migrasi.xlsx");
    expect(exec.status).toBe(201);
    expect(exec.body.data.slug).toBe("koperasi-uji");
  });

  it("rejects a non-xlsx upload and a missing file", async () => {
    const bad = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", Buffer.from("hello"), "x.xlsx");
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("MIGRATION_FILE_INVALID");
    expect((await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`)).status).toBe(422);
  });

  it("never echoes the admin password", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", buf, "m.xlsx");
    const exec = await request(app()).post(`${P}/execute`).set("Authorization", `Bearer ${token}`)
      .field("fileHash", pre.body.data.fileHash).field("adminPassword", "Rahasia123").attach("file", buf, "m.xlsx");
    expect(JSON.stringify(exec.body)).not.toContain("Rahasia123");
  });
});
```

Run -> Expected: FAIL (404 rute belum ada).

- [ ] **Step 2: Implementasi**

```ts
// apps/backend/src/modules/migration/routes.ts
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ErrorCode } from "@siskop/types";
import { authClaims } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { executeMigration, previewMigration } from "./service.js";
import { buildTemplate } from "./template.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const executeBody = z.object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/), adminPassword: z.string().min(8) });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
}
function file(req: Request): Buffer {
  if (!req.file) throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File .xlsx wajib diunggah");
  return req.file.buffer;
}

/** Mounted under /api/platform, which already applies requireAuth + requirePlatformAdmin. */
export function migrationRoutes(): Router {
  const router = Router();

  router.get("/templates/:mode", handle(async (req, res) => {
    const mode = String(req.params.mode).toUpperCase();
    if (mode !== "SISTEM" && mode !== "LAPORAN") throw new AppError(ErrorCode.NOT_FOUND, "Template tidak ditemukan");
    res.setHeader("Content-Type", XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="SISKOP-Template-Migrasi-${mode === "SISTEM" ? "Sistem" : "Laporan"}.xlsx"`);
    res.send(await buildTemplate(mode));
  }));

  router.post("/preview", upload.single("file"), handle(async (req, res) => {
    const data = await previewMigration(file(req));
    res.json({ success: true, data, meta: res.locals.meta });
  }));

  router.post("/execute", upload.single("file"), handle(async (req, res) => {
    const body = executeBody.parse(req.body);
    const claims = authClaims(req);
    const data = await executeMigration(file(req), {
      fileHash: body.fileHash, adminPassword: body.adminPassword,
      actor: { userId: claims.userId, requestId: String(res.locals.meta?.requestId ?? ""), ip: req.ip, userAgent: req.get("user-agent") }
    });
    res.status(201).json({ success: true, data, meta: res.locals.meta });
  }));

  return router;
}
```

Di `apps/backend/src/modules/platform/routes.ts`: tambah `import { migrationRoutes } from "../migration/routes.js";` dan, setelah `router.use("/invoices", invoiceAdminRoutes());`, tambahkan
```ts
  // Koperasi migration from the standard workbook templates (preview = dry run, execute = commit).
  router.use("/migration", migrationRoutes());
```
Bila `res.locals.meta` tidak memuat `requestId`, ambil dari `currentRequestContext()?.requestId` (`lib/request-context.ts`).

- [ ] **Step 3: Jalankan test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-routes.test.ts`
Expected: PASS (6 test). Galat multer (file > 10 MB) harus keluar sebagai envelope `ApiResponse`; bila handler galat global tidak memetakan `MulterError`, tambahkan pemetaan ke `VALIDATION_ERROR` (422) di sana dan tambahkan satu test untuk file 11 MB.

- [ ] **Step 4: Pastikan kata sandi tidak masuk log**

Run: `grep -rn "req.body" apps/backend/src/app.ts apps/backend/src/middleware | head`
Expected: tidak ada pencatatan `req.body` utuh. Jika ada logger body, kecualikan path `/api/platform/migration/execute`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/routes.ts apps/backend/src/modules/platform/routes.ts apps/backend/tests/migration-routes.test.ts
git commit -m "feat(migration): platform routes for template download, preview and execute"
```

---

## Task 11: Frontend

Tidak ada React Testing Library di `apps/frontend`; logika diuji sebagai fungsi murni, tampilan diverifikasi manual (Task 12).

**Files:**
- Create: `apps/frontend/src/pages/platform/migration/issues.ts`, `issues.test.ts`, `UploadStep.tsx`, `PreviewStep.tsx`, `ResultStep.tsx`
- Create: `apps/frontend/src/pages/platform/PlatformMigrationPage.tsx`
- Modify: `apps/frontend/src/components/layout/nav.ts`, `nav.test.ts`, `apps/frontend/src/App.tsx`

- [ ] **Step 1: Test fungsi murni (gagal)**

```ts
// apps/frontend/src/pages/platform/migration/issues.test.ts
import { describe, expect, it } from "vitest";
import type { MigrationIssue } from "@siskop/types";
import { groupIssues, issueCounts } from "./issues";

const i = (severity: "error" | "warning", sheet: string, row: number | null, message = "m"): MigrationIssue => ({ severity, sheet, row, column: null, message });

describe("issues", () => {
  it("counts by severity", () => {
    expect(issueCounts([i("error", "a", 1), i("warning", "a", 2), i("error", "b", 3)])).toEqual({ errors: 2, warnings: 1 });
  });
  it("groups by sheet with errors first, then row order", () => {
    const g = groupIssues([i("warning", "b", 2), i("error", "b", 9), i("error", "a", 5), i("error", "a", 1)]);
    expect(g.map((x) => x.sheet)).toEqual(["a", "b"]);
    expect(g[0]!.issues.map((x) => x.row)).toEqual([1, 5]);
    expect(g[1]!.issues.map((x) => x.severity)).toEqual(["error", "warning"]);
  });
});
```

Run: `pnpm --filter @siskop/frontend exec vitest run src/pages/platform/migration/issues.test.ts` -> Expected: FAIL.

- [ ] **Step 2: Implementasi `issues.ts`**

```ts
// apps/frontend/src/pages/platform/migration/issues.ts
import type { MigrationIssue } from "@siskop/types";

export function issueCounts(issues: readonly MigrationIssue[]) {
  return { errors: issues.filter((x) => x.severity === "error").length, warnings: issues.filter((x) => x.severity === "warning").length };
}

/** One group per sheet (sorted by name); inside, errors before warnings, then by row. */
export function groupIssues(issues: readonly MigrationIssue[]) {
  const map = new Map<string, MigrationIssue[]>();
  for (const x of issues) map.set(x.sheet, [...(map.get(x.sheet) ?? []), x]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sheet, list]) => ({
    sheet,
    issues: [...list].sort((p, q) => (p.severity === q.severity ? (p.row ?? 0) - (q.row ?? 0) : p.severity === "error" ? -1 : 1))
  }));
}
```
Run test -> PASS.

- [ ] **Step 3: Halaman wizard**

```tsx
// apps/frontend/src/pages/platform/PlatformMigrationPage.tsx
import { useState } from "react";
import { Navigate } from "react-router-dom";
import type { MigrationPreview, MigrationResult } from "@siskop/types";
import { useAuth } from "@/stores/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Stepper } from "@/components/shared/Stepper";
import { UploadStep } from "./migration/UploadStep";
import { PreviewStep } from "./migration/PreviewStep";
import { ResultStep } from "./migration/ResultStep";

const STEPS = ["Unggah", "Pratinjau", "Eksekusi", "Selesai"] as const;

export function PlatformMigrationPage() {
  const role = useAuth((s) => s.user?.role);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const step = result ? 3 : preview ? 1 : 0;
  const reset = () => { setFile(null); setPreview(null); setResult(null); };

  return (
    <div className="space-y-6">
      <PageHeader title="Migrasi Koperasi" description="Pindahkan data koperasi dari template standar. Pratinjau tidak menyimpan apa pun." />
      <Stepper steps={STEPS} current={step} />
      {!preview && !result && <UploadStep onPreview={(f, p) => { setFile(f); setPreview(p); }} />}
      {preview && file && !result && <PreviewStep file={file} preview={preview} onBack={reset} onDone={setResult} />}
      {result && <ResultStep result={result} onAnother={reset} />}
    </div>
  );
}
```

`UploadStep.tsx`:
```tsx
import { useState } from "react";
import type { MigrationPreview } from "@siskop/types";
import { apiUpload, ApiRequestError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/shared/FormError";

async function downloadTemplate(mode: "sistem" | "laporan") {
  // apiFetch parses JSON, so fetch the binary directly with the same bearer token.
  const { useAuth } = await import("@/stores/auth");
  const token = useAuth.getState().accessToken;
  const res = await fetch(`/api/platform/migration/templates/${mode}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("Template gagal diunduh");
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `SISKOP-Template-Migrasi-${mode === "sistem" ? "Sistem" : "Laporan"}.xlsx` });
  a.click();
  URL.revokeObjectURL(url);
}

export function UploadStep({ onPreview }: { onPreview: (file: File, preview: MigrationPreview) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      onPreview(file, await apiUpload<MigrationPreview>("/platform/migration/preview", form));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Pratinjau gagal");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-2">
        <p className="text-sm font-semibold">1. Unduh template yang sesuai</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void downloadTemplate("sistem")}>Template Sistem (ada data rinci)</Button>
          <Button variant="outline" onClick={() => void downloadTemplate("laporan")}>Template Laporan (hanya Neraca dan RAT)</Button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">2. Unggah file yang sudah diisi admin koperasi</p>
        <Input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <FormError error={error} />
        <Button onClick={() => void submit()} disabled={!file || busy}>{busy ? "Memeriksa..." : "Pratinjau"}</Button>
      </div>
    </div>
  );
}
```
(Pastikan nama properti token pada store `useAuth` sesuai: `grep -n "accessToken" apps/frontend/src/stores/auth.ts`; sesuaikan baris `useAuth.getState().accessToken` bila berbeda.)

`PreviewStep.tsx`:
```tsx
import { useState } from "react";
import type { MigrationPreview, MigrationResult } from "@siskop/types";
import { apiUpload, ApiRequestError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/shared/FormError";
import { groupIssues, issueCounts } from "./issues";

const idr = (v: string) => Number(v).toLocaleString("id-ID");

export function PreviewStep({ file, preview, onBack, onDone }: { file: File; preview: MigrationPreview; onBack: () => void; onDone: (r: MigrationResult) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { errors, warnings } = issueCounts(preview.issues);

  async function execute() {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file); form.append("fileHash", preview.fileHash); form.append("adminPassword", password);
      onDone(await apiUpload<MigrationResult>("/platform/migration/execute", form));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Eksekusi gagal");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">{file.name} · template {preview.mode ?? "tidak dikenali"}</p>
        <p className="text-lg font-bold">{preview.tenantName ?? "(nama koperasi belum terbaca)"}</p>
        <p className="text-sm">Subdomain: {preview.slug ?? "-"} · Cut-off: {preview.cutoffDate ?? "-"}</p>
        <div className="mt-2 flex gap-2">
          <Badge variant={errors ? "destructive" : "secondary"}>{errors} kesalahan</Badge>
          <Badge variant="secondary">{warnings} peringatan</Badge>
        </div>
      </div>

      {preview.totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[["Anggota", String(preview.totals.members)], ["Rekening simpanan", String(preview.totals.savingAccounts)],
            ["Pinjaman", String(preview.totals.loans)], ["Sisa pokok pinjaman", `Rp ${idr(preview.totals.loanRemainingPrincipal)}`],
            ...Object.entries(preview.totals.savingBalanceByType).map(([t, v]) => [`Simpanan ${t}`, `Rp ${idr(v)}`]),
            ["Total debit sheet 9", `Rp ${idr(preview.totals.trialDebit)}`], ["Total kredit sheet 9", `Rp ${idr(preview.totals.trialCredit)}`]].map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="font-bold">{v}</p></div>
          ))}
        </div>
      )}

      {preview.openingEntry.length > 0 && (
        <div className="rounded-lg border bg-card p-5">
          <p className="mb-2 text-sm font-semibold">Jurnal "Saldo Awal Migrasi" yang akan dibuat (hanya selisih terhadap jurnal otomatis)</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Akun</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead>
            <tbody>{preview.openingEntry.map((l) => (
              <tr key={l.accountCode}><td>{l.accountCode} {l.accountName}</td><td className="text-right">{Number(l.debit) ? idr(l.debit) : ""}</td><td className="text-right">{Number(l.credit) ? idr(l.credit) : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {groupIssues(preview.issues).map((g) => (
        <div key={g.sheet} className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">{g.sheet}</p>
          <ul className="space-y-1 text-sm">
            {g.issues.map((x, idx) => (
              <li key={idx} className={x.severity === "error" ? "text-destructive" : "text-amber-600"}>
                {x.row ? `Baris ${x.row}` : "Sheet"}{x.column ? ` · ${x.column}` : ""}: {x.message}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="space-y-3 rounded-lg border bg-card p-5">
        <Label htmlFor="adminPassword">Kata sandi admin koperasi (min. 8 karakter, diserahkan ke admin lewat jalur aman)</Label>
        <Input id="adminPassword" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <FormError error={error} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={busy}>Unggah ulang</Button>
          <Button onClick={() => void execute()} disabled={!preview.canExecute || password.length < 8 || busy}>
            {busy ? "Memigrasi..." : "Eksekusi migrasi"}
          </Button>
        </div>
        {!preview.canExecute && <p className="text-sm text-destructive">Perbaiki semua kesalahan di file lalu unggah ulang.</p>}
      </div>
    </div>
  );
}
```

`ResultStep.tsx`:
```tsx
import type { MigrationResult } from "@siskop/types";
import { Button } from "@/components/ui/button";

export function ResultStep({ result, onAnother }: { result: MigrationResult; onAnother: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <p className="text-lg font-bold">Migrasi selesai: {result.slug}</p>
      <ul className="list-disc pl-5 text-sm">
        {result.counts.map((c) => <li key={c.sheet}>{c.sheet}: {c.rows}</li>)}
        <li>Nomor jurnal Saldo Awal Migrasi: {result.openingEntryNo ?? "-"}</li>
      </ul>
      <p className="text-sm text-muted-foreground">Langkah berikut: atur paket langganan di halaman Koperasi, serahkan kata sandi admin lewat jalur aman, lalu minta admin mencocokkan Neraca per tanggal cut-off.</p>
      <Button onClick={onAnother}>Migrasi koperasi lain</Button>
    </div>
  );
}
```

- [ ] **Step 4: Menu dan rute**

`nav.ts`: tambahkan impor ikon `FileUp` dari `lucide-react` pada daftar impor yang ada, dan satu entri di `PLATFORM_NAV` setelah `p-tenants`:
```ts
  { id: "p-migration", label: "Migrasi koperasi", href: "/platform/migration", icon: FileUp, group: "platform" },
```
`nav.test.ts`: pada array `/platform/...` di test "gives a platform admin only the platform group" sisipkan `"/platform/migration"` tepat setelah `"/platform/tenants"`.
`App.tsx`: tambahkan lazy import (mengikuti pola baris 91-105):
```tsx
const PlatformMigrationPage = lazy(() =>
  import("@/pages/platform/PlatformMigrationPage").then((module) => ({ default: module.PlatformMigrationPage }))
);
```
dan rute `<Route path='/platform/migration' element={<PlatformMigrationPage />} />` setelah rute `/platform/tenants`.

- [ ] **Step 5: Verifikasi**

Run: `pnpm --filter @siskop/frontend exec vitest run && pnpm run typecheck && pnpm run lint`
Expected: PASS, typecheck dan lint bersih.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend
git commit -m "feat(migration): platform migration wizard page"
```

---

## Task 12: Verifikasi nyata, performa, dan serah terima

**Files:**
- Modify: `docs/migration/MIGRATION-FIELD-MAPPING.md` (catatan hasil), `CLAUDE.md` tidak diubah.
- Create: `docs/migration/RUNBOOK-migrasi-koperasi.md`

- [ ] **Step 1: Benchmark skala**

Tulis skrip sekali pakai di scratchpad (bukan di repo) yang memakai `fixtureWorkbook` dengan 5.000 anggota, 5.000 rekening simpanan, 1.500 pinjaman, lalu memanggil `previewMigration` terhadap DB uji dan mencetak durasinya.
Run: `pnpm --filter @siskop/backend exec tsx <path-skrip>`
Expected: catat durasi. Bila > 60 detik, buka tugas lanjutan "migrasi asinkron" (D2) dan jangan merilis ke koperasi besar; bila lebih kecil, catat angkanya di bagian 7 B8 dokumen pemetaan.

- [ ] **Step 2: Cek jalur Firebase**

Baca `apps/backend/src/modules/identity-provisioning/` (`identityProvisioner.create`). Pastikan: (a) `persist` berjalan dalam transaksi dengan timeout cukup untuk importer, (b) bila transaksi gagal akun Firebase yang sudah dibuat dibersihkan. Bila salah satu tidak terpenuhi, hanya jalankan migrasi produksi dengan `FIREBASE_ACCOUNT_PROVISIONING_ENABLED` dimatikan atau perbaiki jalur itu dalam tugas terpisah; catat keputusan di runbook.

- [ ] **Step 3: Uji manual di staging/lokal (stack scratch, bukan port pengguna)**

Per memory "Dev ports are the user's": jalankan backend dan Vite pada 3100/3101, dengan `DATABASE_URL` diarahkan eksplisit ke database scratch (bukan staging). Langkah:
1. Login sebagai platform admin, buka `/platform/migration`.
2. Unduh kedua template, isi contoh kecil (3 anggota), unggah. Pastikan galat sengaja (NIK 15 digit, kode produk salah, neraca tidak seimbang) muncul dengan sheet/baris/kolom benar.
3. Eksekusi, login sebagai admin baru di subdomain tenant, cocokkan Daftar Anggota, Simpanan, Pinjaman, dan Neraca per tanggal cut-off dengan angka sheet 9.
4. Ulangi dengan file yang sama: pratinjau harus menolak (slug sudah dipakai).
Expected: semua sesuai; simpan tangkapan layar sebagai bukti QA.

- [ ] **Step 4: Runbook**

Buat `docs/migration/RUNBOOK-migrasi-koperasi.md` berisi: prasyarat (backup DB sebelum migrasi produksi; pastikan `.env` tidak menunjuk staging secara tidak sengaja), langkah platform owner (unduh template -> kirim ke admin -> terima file lewat jalur aman -> pratinjau -> eksekusi -> serah kata sandi -> atur paket di halaman Koperasi -> admin verifikasi Neraca), tabel pesan galat umum dan perbaikannya, dan prosedur pemulihan bila migrasi salah: hapus tenant lewat prosedur ops yang ada (cascade menghapus semua tabel milik tenant), perbaiki file, ulangi. Catat bahwa penghapusan tenant juga menghapus slug cadangan dan harus disetujui pemilik platform.

- [ ] **Step 5: Suite penuh dan gerbang cakupan**

Run: `pnpm run test && pnpm run lint && pnpm run typecheck`
Expected: suite lulus (suite backend ~13 menit; satu timeout dikenal pada main tanpa modifikasi, lihat memory "Backend test database"), cakupan baris backend >= 80%.

- [ ] **Step 6: Commit**

```bash
git add docs/migration
git commit -m "docs(migration): runbook and benchmark notes"
```

---

## Task 11b: Laporan pratinjau untuk koperasi (ditambahkan setelah mockup disetujui)

`apps/frontend/src/pages/platform/migration/report.ts`: `buildIssueReportCsv(preview, fileName, now)` (CSV UTF-8 BOM, CRLF, kolom Tingkat/Sheet/Baris/Kolom/Masalah/Perbaikan/Status; nomor baris = baris Excel file koperasi; kesalahan sebelum peringatan) dan `buildIssueSummaryText(preview, fileName)` (ringkasan WhatsApp/email, maksimal 5 contoh). Tombol "Unduh laporan untuk koperasi (CSV)" dan "Salin ringkasan" di `PreviewStep.tsx`. Pesan galat tidak mengulang NIK lengkap (`maskNik` di `validate.ts`, empat digit terakhir). Dites di `issues.test.ts`. **Terimplementasi.**

## Catatan pelaksanaan (2026-10-31)

Perbedaan antara rencana ini dan kode yang dibangun:

- Sheet `7_Pinjaman` dijadikan **opsional** di kedua template (koperasi tanpa pinjaman sah).
- `withManagedIdentity` mendapat parameter opsional `options` (timeout transaksi) karena bawaan Prisma 5 detik.
- `apiDownload` ditambahkan di `apps/frontend/src/api/client.ts` untuk mengunduh template dengan penyegaran token.
- Migrasi `20261030120000_loan_notes` harus diterapkan ke `siskop_test` (`prisma migrate deploy` dengan `DATABASE_URL` dari `.env.test`) sebelum test importer dapat berjalan.
- **Benchmark (Task 12 step 1):** 5.000 anggota + 5.000 rekening simpanan + 1.500 pinjaman = 166 detik pratinjau, 154 detik eksekusi. Melewati ambang 60 detik pada D2. Tindak lanjut yang disarankan: jurnal massal (lihat B8 di MIGRATION-FIELD-MAPPING.md) sebelum dipakai untuk koperasi di atas sekitar 1.000 rekening.

## Self-review

**Cakupan terhadap permintaan:** UI khusus migrasi untuk platform owner (Task 11), memakai format standar (dua template, Task 2-3), tanpa AI (seluruh alur deterministik), pratinjau sebelum commit (Task 9), dua jalur Sistem/Laporan (Task 4, 7, 8), pemetaan dokumen tetap sumber kebenaran (Task 2 step 5, 12).

**Butir terbuka MIGRATION-FIELD-MAPPING yang ditutup:** B1 (D3), B2 (kuota tidak diperiksa saat impor; platform owner mengatur paket sesudahnya, dan peringatan kuota ditambahkan bila perlu pada iterasi berikut), B7 (audit `tenant.migrate`, Task 7), B8 (bulk `createManyAndReturn` untuk anggota; simpanan dan pinjaman tetap per baris, diukur di Task 12). **Masih terbuka dan sengaja tidak dikerjakan:** B3, B4, B5, B6, B9, B10, B11 (keputusan produk/schema).

**Risiko yang diketahui:** (1) Simpanan dan pinjaman dijurnal per baris; 5.000 rekening bisa lambat, diukur di Task 12. (2) `Map.groupBy` pada Task 7 butuh Node 22 (sudah di toolchain, lihat memory "Node 22 toolchain") dan lib TS `ES2024`; ganti dengan loop bila typecheck menolak. (3) `createManyAndReturn` dilewatkan extension tenant-scope (sudah ada penanganannya di `lib/tenant-scope.ts:177`), tetapi harus lolos uji Task 7. (4) Jalur Firebase tidak dapat diuji di test otomatis, hanya dibaca dan diuji manual (Task 12 step 2).

**Konsistensi nama:** `readWorkbook` / `parseRows` / `validateData` / `accountIndex` / `targetNet` / `openingLines` / `runMigration` / `previewMigration` / `executeMigration` / `buildTemplate` / `templateSheets` dipakai identik di semua task. `ParsedData`, `LoanRow`, `MigrationPreview`, `MigrationResult` didefinisikan sebelum dipakai.
