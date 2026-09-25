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
