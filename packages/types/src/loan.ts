import type { RateType } from "./savings";

export type LoanType = "SYARIAH" | "KONVENSIONAL";
export type LoanStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "DEFAULTED";
export type KOLCategory = "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET";

export interface LoanConfig {
  id: string;
  tenantId: string;
  name: string;
  type: LoanType;
  rateType: RateType;
  /** Decimal(8,4), serialized as a string over the wire. */
  rate: string;
  maxTermMonths: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateLoanConfigRequest {
  name: string;
  type: LoanType;
  rateType: RateType;
  rate: number;
  maxTermMonths: number;
}

export type UpdateLoanConfigRequest = Partial<CreateLoanConfigRequest>;

/** A member's loan. `unitId` is always server-resolved — never client input. */
export interface Loan {
  id: string;
  tenantId: string;
  unitId: string;
  memberId: string;
  loanConfigId: string;
  principalAmount: string;
  totalAmount: string;
  termMonths: number;
  monthlyPayment: string;
  remainingAmount: string;
  status: LoanStatus;
  kolCategory: KOLCategory;
  daysOverdue: number;
  disbursedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLoanRequest {
  memberId: string;
  loanConfigId: string;
  principalAmount: number;
  termMonths: number;
  /** Resubmit with `force: true` to create a second loan after seeing `hasExistingLoan`. */
  force?: boolean;
  disbursedAt?: string;
}

/**
 * A member with an existing ACTIVE/PENDING loan gets HTTP 200 with
 * `hasExistingLoan: true` rather than an error — the caller must resubmit
 * with `force: true`. This is intentional (ported verbatim), not a bug.
 * The two cases are a real union, not one combined shape: on success the
 * response body IS the created `Loan` (no wrapper); on the warning path it's
 * `{ hasExistingLoan: true, existingLoan }` instead. Narrow with
 * `"hasExistingLoan" in result`.
 */
export type CreateLoanResponse =
  | Loan
  | { hasExistingLoan: true; existingLoan: { id: string; principalAmount: string; remainingAmount: string } };

export interface LoanPaymentRequest {
  amount: number;
  penalty?: number;
  paidAt: string;
  dueDate: string;
  note?: string;
}

export interface LoanPaymentResult {
  loanId: string;
  newRemaining: string;
  status: LoanStatus;
  kolCategory: KOLCategory;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  tenantId: string;
  amount: string;
  penalty: string;
  paidAt: string;
  dueDate: string;
  note?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ListLoansQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: LoanStatus;
  kolCategory?: KOLCategory;
  memberId?: string;
  loanConfigId?: string;
}
