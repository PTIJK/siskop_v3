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
      issues.push({
        severity: "error",
        sheet,
        row: Number(cell.row),
        column,
        message: "Kolom ini tersimpan sebagai angka. Ubah format kolom menjadi Teks lalu ketik ulang."
      });
      return null;
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "YA" : "TIDAK";
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if ("formula" in value || "sharedFormula" in value) {
    issues.push({
      severity: "error",
      sheet,
      row: Number(cell.row),
      column,
      message: "Sel berisi rumus. Salin sebagai nilai (Paste Special > Values)."
    });
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
    // exceljs types its own Buffer alias, which newer @types/node Buffers do not satisfy.
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File .xlsx tidak dapat dibaca");
  }

  const issues: MigrationIssue[] = [];
  const names = wb.worksheets.map((w) => w.name);
  const hasSistem = names.includes("9_Saldo_Awal_Jurnal");
  const hasLaporan = names.includes("9_Neraca");
  let mode: MigrationMode | null = null;
  if (hasSistem && hasLaporan) {
    issues.push({
      severity: "error",
      sheet: "(file)",
      row: null,
      column: null,
      message: "File memuat 9_Saldo_Awal_Jurnal dan 9_Neraca sekaligus. Gunakan satu template saja."
    });
  } else if (!hasSistem && !hasLaporan) {
    issues.push({
      severity: "error",
      sheet: "(file)",
      row: null,
      column: null,
      message: "Sheet 9_Saldo_Awal_Jurnal atau 9_Neraca tidak ditemukan. Pakai template resmi."
    });
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
