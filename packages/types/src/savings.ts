export type SavingType = "POKOK" | "WAJIB" | "SUKARELA";
export type RateType = "BUNGA" | "BAGI_HASIL" | "MARGIN";
export type SavingPeriodUnit = "MONTHLY" | "YEARLY";
export type SavingTransactionType = "DEPOSIT" | "WITHDRAWAL";

export interface SavingConfig {
  id: string;
  tenantId: string;
  name: string;
  type: SavingType;
  rateType: RateType;
  /** Decimal(8,4), serialized as a string over the wire. */
  rate: string;
  periodUnit: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CreateSavingConfigRequest {
  name: string;
  type: SavingType;
  rateType: RateType;
  rate: number;
  periodUnit: SavingPeriodUnit;
}

export type UpdateSavingConfigRequest = Partial<CreateSavingConfigRequest>;

/** A member's savings balance. `unitId` is always server-resolved — never client input. */
export interface Saving {
  id: string;
  tenantId: string;
  unitId: string;
  memberId: string;
  savingConfigId: string;
  /** Decimal(15,2), serialized as a string over the wire. */
  balance: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavingRequest {
  memberId: string;
  savingConfigId: string;
  initialDeposit?: number;
}

export interface SavingTransactionRequest {
  amount: number;
  note?: string;
}

export interface SavingTransaction {
  id: string;
  savingId: string;
  tenantId: string;
  type: SavingTransactionType;
  amount: string;
  note?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ListSavingsQuery {
  page?: number;
  limit?: number;
  search?: string;
  memberId?: string;
  type?: SavingType;
}

export interface ListSavingTransactionsQuery {
  page?: number;
  limit?: number;
}
