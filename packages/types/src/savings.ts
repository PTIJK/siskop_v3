export type SavingType = "POKOK" | "WAJIB" | "SUKARELA";
export type RateType = "BUNGA" | "BAGI_HASIL" | "MARGIN" | "HARIAN";
export type SavingPeriodUnit = "DAILY" | "MONTHLY" | "YEARLY";
export type SavingTransactionType = "DEPOSIT" | "WITHDRAWAL" | "INTEREST";

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
  /** Null for a scheduler-posted INTEREST row — there's no acting staff user. */
  createdBy: string | null;
  createdAt: string;
}

export interface ListSavingsQuery {
  page?: number;
  limit?: number;
  search?: string;
  memberId?: string;
  type?: SavingType;
}

/** One row of the Simpanan list grouped by member — `GET /api/savings/by-member`. */
export interface MemberSavingsSummary {
  /** Member.id (cuid). */
  memberId: string;
  /** Member.memberId — the human-readable member number. */
  memberNumber: string;
  fullName: string;
  accountNumber: string;
  /** Sum of `savings[].balance`, Decimal serialized as a string. */
  totalBalance: string;
  savings: { id: string; name: string; type: SavingType; balance: string }[];
}

export interface ListSavingTransactionsQuery {
  page?: number;
  limit?: number;
}

/** Period for a Rekening Koran (bank-statement) view — `YYYY-MM-DD`, inclusive.
 * Both default server-side: `from` to the 1st of the current month, `to` to today. */
export interface SavingStatementQuery {
  from?: string;
  to?: string;
}

/**
 * One line of a savings account statement, from the account holder's side:
 * money in (DEPOSIT, INTEREST) is `credit`, money out (WITHDRAWAL) is `debit`;
 * the other column is "0". `balance` is the running balance after this line.
 * Decimal(15,2) values serialized as strings.
 */
export interface SavingStatementRow {
  id: string;
  date: string;
  type: SavingTransactionType;
  note: string | null;
  debit: string;
  credit: string;
  balance: string;
  /** Acting staff user; null for scheduler-posted INTEREST and in member-portal responses. */
  createdByName: string | null;
}

export interface SavingStatement {
  saving: {
    id: string;
    configName: string;
    type: SavingType;
    member: { fullName: string; memberId: string };
  };
  period: { from: string; to: string };
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  /** Chronological (oldest first), like a printed bank statement. */
  rows: SavingStatementRow[];
}
