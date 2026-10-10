export type AccountCategory = "ASET" | "KEWAJIBAN" | "EKUITAS" | "PENDAPATAN" | "BEBAN";
export type NormalBalance = "DEBIT" | "KREDIT";

/** Sub-classification of an EKUITAS account (Permenkop UKM 2/2024 lampiran, Akuntansi Ekuitas). */
export const EQUITY_CLASSES = [
  "SIMPANAN_POKOK",
  "SIMPANAN_WAJIB",
  "MODAL_TETAP",
  "CADANGAN_UMUM",
  "CADANGAN_RISIKO",
  "HIBAH",
  "MODAL_PENYERTAAN",
  "SHU",
  "EKUITAS_LAIN"
] as const;
export type EquityClass = (typeof EQUITY_CLASSES)[number];

export const EQUITY_CLASS_LABELS: Record<EquityClass, string> = {
  SIMPANAN_POKOK: "Simpanan Pokok",
  SIMPANAN_WAJIB: "Simpanan Wajib",
  MODAL_TETAP: "Modal Tetap (USP)",
  CADANGAN_UMUM: "Cadangan Umum",
  CADANGAN_RISIKO: "Cadangan Risiko",
  HIBAH: "Hibah",
  MODAL_PENYERTAAN: "Modal Penyertaan",
  SHU: "Sisa Hasil Usaha",
  EKUITAS_LAIN: "Ekuitas Lain"
};
export type MappingSourceType = "SAVING_CONFIG" | "LOAN_CONFIG" | "SYSTEM";
export type MappingTransactionKind =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "SAVING_INTEREST"
  | "DISBURSEMENT"
  | "PAYMENT_PRINCIPAL"
  | "PAYMENT_INTEREST"
  | "PAYMENT_PENALTY"
  // Toko (KONSUMEN unit) — tenant-wide SYSTEM mappings, see lib/journal.ts#postPosSale.
  | "SALE_REVENUE"
  | "SALE_COGS"
  | "SALE_RECEIVABLE"
  | "MEMBER_CREDIT_REPAYMENT"
  | "STOCK_PURCHASE";

/** The SYSTEM-scope kinds, i.e. the ones that carry no per-config `sourceId`. */
export const SYSTEM_MAPPING_KINDS = [
  "SALE_REVENUE",
  "SALE_COGS",
  "SALE_RECEIVABLE",
  "MEMBER_CREDIT_REPAYMENT",
  "STOCK_PURCHASE"
] as const;

export interface Account {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  parentId: string | null;
  isHeader: boolean;
  isDefault: boolean;
  isActive: boolean;
  isCashEquivalent: boolean;
  /** Set only on EKUITAS accounts; null everywhere else. */
  equityClass: EquityClass | null;
  createdAt: string;
}

export interface CreateAccountRequest {
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  parentId?: string;
  isHeader?: boolean;
  isCashEquivalent?: boolean;
  /** Only allowed when category is EKUITAS. */
  equityClass?: EquityClass;
}

export type UpdateAccountRequest = Partial<Omit<CreateAccountRequest, "equityClass">> & {
  isActive?: boolean;
  /** null clears it. */
  equityClass?: EquityClass | null;
};

export interface AccountMapping {
  id: string;
  tenantId: string;
  sourceType: MappingSourceType;
  sourceId: string | null;
  /** Present only when sourceType is SAVING_CONFIG/LOAN_CONFIG — the config's name, resolved server-side. */
  sourceName?: string | null;
  transactionKind: MappingTransactionKind;
  debitAccountId: string;
  debitAccountName?: string;
  creditAccountId: string;
  creditAccountName?: string;
  createdAt: string;
}

export interface UpsertAccountMappingRequest {
  sourceType: MappingSourceType;
  sourceId?: string;
  transactionKind: MappingTransactionKind;
  debitAccountId: string;
  creditAccountId: string;
}

export interface GenerateStandardCoaResult {
  accountsCreated: number;
  accountsSkipped: number;
  mappingsCreated: number;
  mappingsSkipped: number;
}

/**
 * Journal entries stored as UNPOSTED_MISSING_MAPPING (a transaction that
 * happened before its account mapping existed), grouped by what produced them.
 * `repostable` is true only for source types the repost action can rebuild.
 */
export interface UnpostedJournalItem {
  sourceType: string;
  count: number;
  repostable: boolean;
}

export interface UnpostedJournalSummary {
  items: UnpostedJournalItem[];
  /** Sum of `count` over the repostable items — what "Posting sekarang" would act on. */
  repostableCount: number;
}

export interface RepostUnpostedResult {
  reposted: number;
  /** Repostable entries whose required mapping still doesn't exist, left untouched. */
  stillUnmapped: number;
}

// ── Manual journal (Jurnal Manual / Penyesuaian) ─────────────────────────────

/** UMUM = ordinary entry; PENYESUAIAN = period-end correction; PENUTUP = year-end closing (system-posted). */
export type JournalEntryType = "UMUM" | "PENYESUAIAN" | "PENUTUP";

export interface ManualJournalLineInput {
  accountId: string;
  /** Exactly one of debit/credit is a positive amount (max 2 decimals). Money travels as number or string, never float math. */
  debit?: number | string;
  credit?: number | string;
}

export interface CreateManualJournalRequest {
  /** YYYY-MM-DD */
  entryDate: string;
  description: string;
  entryType: Exclude<JournalEntryType, "PENUTUP">;
  /** Omit for the tenant-level "unallocated" bucket. */
  unitId?: string | null;
  lines: ManualJournalLineInput[];
}

export interface ReverseManualJournalRequest {
  /** YYYY-MM-DD; defaults to today. */
  entryDate?: string;
}

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

export interface JournalEntryDetail {
  id: string;
  entryNo: number | null;
  entryDate: string;
  description: string;
  entryType: JournalEntryType;
  sourceType: string;
  unitId: string | null;
  reversalOfId: string | null;
  createdAt: string;
  lines: JournalEntryLine[];
}

// ── Year-end close (Tutup Buku) ──────────────────────────────────────────────

export type YearCloseStatus = "OPEN" | "CLOSED" | "REOPENED";

export interface YearCloseListItem {
  year: number;
  status: YearCloseStatus;
  closedAt: string | null;
  reopenedAt: string | null;
}

export interface YearCloseList {
  /** Asia/Jakarta calendar year; only earlier years can be closed. */
  currentYear: number;
  /** Newest first. */
  years: YearCloseListItem[];
}

export interface YearCloseLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

/** One closing entry: a unit's income and expense moved into the target equity account. */
export interface YearCloseEntryPlan {
  /** null = the tenant-level "unallocated" bucket. */
  unitId: string | null;
  unitName: string | null;
  /** Income minus expense for this scope; negative = a loss. */
  netIncome: string;
  lines: YearCloseLine[];
}

export interface YearClosePlan {
  year: number;
  targetAccount: { id: string; code: string; name: string };
  netIncome: string;
  entries: YearCloseEntryPlan[];
}

export interface YearCloseState {
  year: number;
  status: YearCloseStatus;
  closedAt: string | null;
  reopenedAt: string | null;
}

/** What closing a year returns: the plan that was posted plus the year's new state. */
export interface YearCloseResult extends YearClosePlan, YearCloseState {}

export interface YearCloseRequest {
  /** Equity account that receives the net income; defaults to "SHU Tahun Lalu Belum Dibagi" (3-3100). */
  targetAccountId?: string;
}
