import type { ManualJournalLineInput } from "@siskop/types";

export interface DraftLine {
  /** Stable React key; not sent to the API. */
  key: string;
  accountId: string;
  debit: string;
  credit: string;
}

/**
 * Amount text -> whole sen, so totals add up exactly (no float drift). Blank is 0;
 * null means invalid: not a number, negative, or more than 2 decimals.
 * Display-side check only; the backend re-validates with Decimal.
 */
export function parseCents(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export interface LineSummary {
  totalDebit: number;
  totalCredit: number;
  difference: number;
  canSubmit: boolean;
  /** First blocking problem, for display under the table; null when fine or merely incomplete. */
  error: string | null;
}

export function summarizeLines(lines: DraftLine[]): LineSummary {
  let totalDebit = 0;
  let totalCredit = 0;
  let error: string | null = null;
  let complete = lines.length >= 2;

  for (const l of lines) {
    const debit = parseCents(l.debit);
    const credit = parseCents(l.credit);
    if (debit === null || credit === null) {
      error ??= "Jumlah tidak valid: gunakan angka positif dengan maksimal 2 desimal";
      complete = false;
      continue;
    }
    totalDebit += debit;
    totalCredit += credit;
    // exactly one side filled, and an account chosen
    if (!l.accountId || (debit > 0) === (credit > 0)) complete = false;
  }

  const difference = Math.abs(totalDebit - totalCredit);
  return { totalDebit, totalCredit, difference, canSubmit: complete && difference === 0 && totalDebit > 0, error };
}

export function toRequestLines(lines: DraftLine[]): ManualJournalLineInput[] {
  return lines.map((l) => {
    const hasDebit = (parseCents(l.debit) ?? 0) > 0;
    return hasDebit ? { accountId: l.accountId, debit: l.debit.trim() } : { accountId: l.accountId, credit: l.credit.trim() };
  });
}
