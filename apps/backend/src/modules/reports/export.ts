import ExcelJS from "exceljs";
import { safeText, toCsv } from "../../lib/csv.js";

/**
 * One export model for every report, rendered to CSV or XLSX. A builder (export-builders.ts)
 * turns a report into rows of typed cells once; the two renderers below decide how a money
 * cell, a date or a bold total looks in each format. Amounts travel as decimal strings from
 * the services and are only turned into numbers at the XLSX boundary.
 */

export type ExportKind = "text" | "money" | "int" | "date";

export interface ExportColumn {
  key: string;
  header: string;
  kind: ExportKind;
  /** Approximate XLSX column width in characters. */
  width?: number;
}

export type ExportCell = string | number | null | undefined;

export interface ExportRow {
  cells: Record<string, ExportCell>;
  /** section = a group heading, subtotal / total = bold footing lines. */
  style?: "section" | "subtotal" | "total";
  /** Chart-of-accounts depth below the root (0 = none): indents the first text column in XLSX. */
  indent?: number;
}

export interface ExportSheet {
  /** Worksheet tab name (Excel limits it to 31 characters, none of []:*?/\). */
  name: string;
  /** Tenant name, then the report title, then a period/unit line: the block above the table. */
  tenantName: string;
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: ExportRow[];
}

/** Reports may not export more rows than this: a runaway Jurnal Umum would exhaust memory building the file. */
export const MAX_EXPORT_ROWS = 50_000;

const BOM = "﻿";

function csvCell(kind: ExportKind, value: ExportCell): string {
  if (value === null || value === undefined) return "";
  // Free text can start with = + - @ and be run as a formula by a spreadsheet; numbers and dates cannot.
  if (kind === "text") return safeText(String(value));
  if (kind === "money") return typeof value === "number" ? value.toFixed(2) : decimalText(String(value));
  return String(value);
}

/** "1000000" -> "1000000.00"; keeps a plain decimal (no separators) so the file imports cleanly. */
function decimalText(value: string): string {
  if (value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

export function renderCsv(sheet: ExportSheet): string {
  const lines: string[][] = [
    [safeText(sheet.tenantName)],
    [sheet.title],
    [safeText(sheet.subtitle)],
    [],
    sheet.columns.map((c) => c.header),
    ...sheet.rows.map((r) => sheet.columns.map((c) => csvCell(c.kind, r.cells[c.key])))
  ];
  return BOM + toCsv(lines);
}

const MONEY_FORMAT = '#,##0.00;[Red]-#,##0.00;"-"';

export async function renderXlsx(sheet: ExportSheet): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet.name.slice(0, 31));

  ws.addRow([sheet.tenantName]).font = { bold: true, size: 13 };
  ws.addRow([sheet.title]).font = { bold: true, size: 12 };
  ws.addRow([sheet.subtitle]).font = { color: { argb: "FF6B7280" } };
  ws.addRow([]);

  const header = ws.addRow(sheet.columns.map((c) => c.header));
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  sheet.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.alignment = { horizontal: c.kind === "money" || c.kind === "int" ? "right" : "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
    ws.getColumn(i + 1).width = c.width ?? (c.kind === "money" ? 18 : c.kind === "text" ? 32 : 14);
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];

  for (const r of sheet.rows) {
    const row = ws.addRow(
      sheet.columns.map((c) => {
        const v = r.cells[c.key];
        if (v === null || v === undefined || v === "") return null;
        if (c.kind === "money" || c.kind === "int") return Number(v);
        if (c.kind === "date") return new Date(`${v}T00:00:00Z`);
        return String(v);
      })
    );
    if (r.style) {
      row.font = { bold: true };
      if (r.style === "total") {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        row.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
      }
      if (r.style === "section") row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    }
    sheet.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.kind === "money") cell.numFmt = MONEY_FORMAT;
      if (c.kind === "int") cell.numFmt = "0";
      if (c.kind === "date") cell.numFmt = "yyyy-mm-dd";
    });
    if (r.indent) {
      const first = sheet.columns.findIndex((c) => c.kind === "text" && r.cells[c.key]);
      // the name column, not the leading code column: the second text column when there is a code
      const nameCol = sheet.columns.findIndex((c, i) => c.kind === "text" && i > first && r.cells[c.key]);
      row.getCell((nameCol >= 0 ? nameCol : first) + 1).alignment = { indent: r.indent };
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
