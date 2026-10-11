import { format } from "date-fns";
import type { SavingStatement, SavingTransactionType } from "@siskop/types";
import { safeText, toCsv } from "../../lib/csv.js";

export const STATEMENT_TYPE_LABEL: Record<SavingTransactionType, string> = {
  DEPOSIT: "Setoran",
  INTEREST: "Bunga",
  WITHDRAWAL: "Penarikan"
};

/** Dates are server-local, matching how the period filter is applied. Amounts
 * stay plain decimal strings (no thousands separators) so the file imports
 * cleanly into a spreadsheet. First line is Saldo Awal, last is Saldo Akhir
 * with the period's debit/credit totals. */
export function savingStatementCsv(statement: SavingStatement): string {
  return toCsv([
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
  ]);
}

export function savingStatementFilename(statement: SavingStatement, ext: "csv" | "pdf"): string {
  const memberNo = statement.saving.member.memberId.replace(/[^A-Za-z0-9_-]/g, "");
  return `rekening-koran-${memberNo}-${statement.period.from}_${statement.period.to}.${ext}`;
}
