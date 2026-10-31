import ExcelJS from "exceljs";
import type { MigrationMode } from "@siskop/types";
import { templateSheets } from "../src/modules/migration/template.js";

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
  name: "Koperasi Uji",
  slug: "koperasi-uji",
  registrationNo: "AHU-001",
  address: "Jl. Uji No. 1, Surabaya",
  type: "KONVENSIONAL",
  cooperativeType: "KSP",
  cutoffDate: "2025-12-31",
  modalDisetor: 50000000,
  adminName: "Admin Uji",
  adminEmail: "admin@koperasi-uji.test"
};
export const UNIT = { unitCode: "U1", type: "KSP", name: "Simpan Pinjam" };
export const ANGGOTA = (nik: string, name: string) => ({
  fullName: name,
  nik,
  address: "Jl. Melati No. 5, Surabaya",
  birthPlace: "Surabaya",
  birthDate: "1985-03-21",
  occupation: "Guru"
});
export const SIMPANAN_POKOK = { code: "SP", name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "YEARLY" };
export const PINJAMAN = {
  code: "PJ",
  name: "Pinjaman Reguler",
  type: "KONVENSIONAL",
  rateType: "BUNGA",
  rate: 12,
  maxTermMonths: 36,
  installmentFrequency: "MONTHLY"
};
