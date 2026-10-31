import type { MigrationPreview } from "@siskop/types";
import { groupIssues, issueCounts } from "./issues";

const BOM = "﻿";

function cell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (...cols: (string | number | null)[]) => cols.map(cell).join(",");

/**
 * A CSV the platform admin sends to the koperasi. Row numbers are the Excel rows of the file the
 * koperasi uploaded, so they can find and fix each one. Perbaikan and Status are left blank for them.
 */
export function buildIssueReportCsv(preview: MigrationPreview, fileName: string, now: Date): string {
  const lines = [
    line("Laporan Pratinjau Migrasi", preview.tenantName ?? ""),
    line("File", fileName),
    line("Tanggal pratinjau", now.toISOString().slice(0, 10)),
    line("Kode file", preview.fileHash.slice(0, 12)),
    "",
    line("Tingkat", "Sheet", "Baris", "Kolom", "Masalah", "Perbaikan", "Status")
  ];
  const groups = groupIssues(preview.issues);
  // Errors first across the whole file, then warnings; each pass keeps sheet and row order.
  for (const severity of ["error", "warning"] as const) {
    for (const g of groups) {
      for (const x of g.issues.filter((y) => y.severity === severity)) {
        lines.push(line(severity === "error" ? "Kesalahan" : "Peringatan", x.sheet, x.row, x.column, x.message, "", ""));
      }
    }
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Short plain text for WhatsApp or email: counts per sheet and the first few errors. */
export function buildIssueSummaryText(preview: MigrationPreview, fileName: string): string {
  const { errors, warnings } = issueCounts(preview.issues);
  const name = preview.tenantName ?? fileName;
  if (errors === 0) {
    return `Pratinjau migrasi ${name} (${fileName}): tidak ada kesalahan${warnings ? `, ${warnings} peringatan` : ""}.`;
  }
  const bySheet = groupIssues(preview.issues)
    .map((g) => ({ sheet: g.sheet, n: g.issues.filter((x) => x.severity === "error").length }))
    .filter((g) => g.n > 0)
    .map((g) => `- ${g.sheet}: ${g.n}`);
  const examples = preview.issues
    .filter((x) => x.severity === "error")
    .slice(0, 5)
    .map((x) => `- ${x.sheet}${x.row ? ` baris ${x.row}` : ""}${x.column ? ` kolom ${x.column}` : ""}: ${x.message}`);
  return [
    `Pratinjau migrasi ${name} (${fileName}): ${errors} kesalahan, ${warnings} peringatan.`,
    "Kesalahan per sheet:",
    ...bySheet,
    "Contoh:",
    ...examples,
    "Daftar lengkap ada di file laporan CSV."
  ].join("\n");
}
