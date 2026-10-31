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

/** An existing, empty koperasi chosen as the migration target (no new tenant is created). */
export interface MigrationTarget {
  tenantId: string;
  name: string;
  slug: string;
}

export interface MigrationPreview {
  mode: MigrationMode | null;
  /** Null when the migration creates a new koperasi from sheet 1. */
  target: MigrationTarget | null;
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
