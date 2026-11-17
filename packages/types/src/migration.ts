import type { ProvisionalMemberIdentity } from "./member.js";

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

export type KopkarRatFileKind = "prepared_review" | "original_master" | "original_template";
export type KopkarRatFlag = "missing_nik" | "unverified_balance";

export interface KopkarRatRow {
  row: number;
  cells: (string | null)[];
  flags: KopkarRatFlag[];
  notes: string[];
}

export interface KopkarRatArchive {
  files: { kind: KopkarRatFileKind; name: string; sheetCount: number }[];
  sheet: {
    kind: KopkarRatFileKind;
    names: string[];
    name: string;
    page: number;
    limit: number;
    total: number;
    rows: KopkarRatRow[];
  } | null;
}

export type RatPublishKind = "member" | "saving" | "loan";

export type RatFinancialKind = Exclude<RatPublishKind, "member">;

export interface RatFinancialDraft {
  sourceRow: number;
  reference: string;
  ownerRef: string;
  name: string;
  productRef: string;
  sourceFields: Record<string, string>;
  fields: Record<string, string>;
  notes: string[];
  revision: number;
}

export interface RatFinancialDirectory {
  rows: RatFinancialDraft[];
  products: { id: string; name: string; type: string }[];
}

export interface RatPublishSource {
  sourceRow: number;
  reference: string;
  name: string;
  value: string | null;
  notes: string[];
  published: boolean;
  correction?: ProvisionalMemberIdentity;
  financialCorrection?: Record<string, string>;
}

export interface RatPublishOptions {
  rows: RatPublishSource[];
  units: { id: string; name: string }[];
  products: { id: string; name: string }[];
  offsets: { id: string; name: string }[];
}

export interface RatPublishPreview {
  token: string;
  kind: RatPublishKind;
  unit: string;
  cutoffDate?: string;
  rows: { sourceRow: number; name: string; action: string; journal?: { debit: string; credit: string; amount: string } }[];
}

export interface RatPublishReceipt {
  rows: { sourceRow: number; journalEntryNo: number | null }[];
  alreadyPublished: boolean;
}
