import { format } from "date-fns";
import type { SavingStatement, SavingTransactionType } from "@siskop/types";

export const STATEMENT_TYPE_LABEL: Record<SavingTransactionType, string> = {
  DEPOSIT: "Setoran",
  INTEREST: "Bunga",
  WITHDRAWAL: "Penarikan"
};

/** RFC 4180 field quoting. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Defuses spreadsheet formula injection from a free-text note: a leading
 * =, +, -, @ gets a quote prefix so Excel/Sheets treat it as text. */
function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Dates are server-local, matching how the period filter is applied. Amounts
 * stay plain decimal strings (no thousands separators) so the file imports
 * cleanly into a spreadsheet. First line is Saldo Awal, last is Saldo Akhir
 * with the period's debit/credit totals. */
export function savingStatementCsv(statement: SavingStatement): string {
  const lines = [
    ["Tanggal", "Jenis", "Keterangan", "Debit", "Kredit", "Saldo"],
    [statement.period.from, "", "Saldo Awal", "", "", statement.openingBalance],
    ...statement.rows.map((r) => [
      format(new Date(r.date), "yyyy-MM-dd"),
      STATEMENT_TYPE_LABEL[r.type],
      safeText(r.note ?? ""),
      r.debit,
      r.credit,
      r.balance
    ]),
    [statement.period.to, "", "Saldo Akhir", statement.totalDebit, statement.totalCredit, statement.closingBalance]
  ];
  return lines.map((cols) => cols.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function savingStatementFilename(statement: SavingStatement, ext: "csv" | "pdf"): string {
  const memberNo = statement.saving.member.memberId.replace(/[^A-Za-z0-9_-]/g, "");
  return `rekening-koran-${memberNo}-${statement.period.from}_${statement.period.to}.${ext}`;
}
