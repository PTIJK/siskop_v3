export type AccountCategory = "ASET" | "KEWAJIBAN" | "EKUITAS" | "PENDAPATAN" | "BEBAN";
export type NormalBalance = "DEBIT" | "KREDIT";
export type MappingSourceType = "SAVING_CONFIG" | "LOAN_CONFIG" | "SYSTEM";
export type MappingTransactionKind =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "DISBURSEMENT"
  | "PAYMENT_PRINCIPAL"
  | "PAYMENT_INTEREST"
  | "PAYMENT_PENALTY";

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
}

export type UpdateAccountRequest = Partial<CreateAccountRequest> & { isActive?: boolean };

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
