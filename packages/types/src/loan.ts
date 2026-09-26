import type { RateType } from "./savings";

export type LoanType = "SYARIAH" | "KONVENSIONAL";
export type LoanStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "DEFAULTED";
export type KOLCategory = "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET";
/** Koperasi pasar plan (docs/2026-09-26-koperasi-pasar-dev-plan.md) F2. */
export type InstallmentFrequency = "DAILY" | "WEEKLY" | "MONTHLY";
export type InstallmentStatus = "UNPAID" | "PARTIAL" | "PAID";

export interface LoanConfig {
  id: string;
  tenantId: string;
  name: string;
  type: LoanType;
  rateType: RateType;
  /** Decimal(8,4), serialized as a string over the wire. */
  rate: string;
  maxTermMonths: number;
  installmentFrequency: InstallmentFrequency;
  /** Cap on installment count for DAILY/WEEKLY — maxTermMonths still caps MONTHLY. */
  maxInstallments: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateLoanConfigRequest {
  name: string;
  type: LoanType;
  rateType: RateType;
  rate: number;
  maxTermMonths: number;
  installmentFrequency?: InstallmentFrequency;
  maxInstallments?: number;
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
  installmentFrequency: InstallmentFrequency;
  installmentCount: number | null;
  installmentAmount: string | null;
  /** Effective annual rate %, snapshotted at creation (D3) — may differ from loanConfig.rate. */
  rate: string | null;
  /** Required when `rate` was overridden away from the product's rate. */
  rateNote: string | null;
  maturityDate?: string | null;
  installments?: LoanInstallment[];
  createdAt: string;
  updatedAt: string;
}

export interface LoanInstallment {
  id: string;
  loanId: string;
  seq: number;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  principalPaid: string;
  interestPaid: string;
  status: InstallmentStatus;
  paidOffAt?: string | null;
}

export interface CreateLoanRequest {
  memberId: string;
  loanConfigId: string;
  principalAmount: number;
  /** Required when the loan config's frequency is MONTHLY. */
  termMonths?: number;
  /** Required when the loan config's frequency is DAILY/WEEKLY. */
  installmentCount?: number;
  /** Employee override of the product's rate — requires `rateNote` (D3), capped at 24%/year. */
  rate?: number;
  rateNote?: string;
  /** Resubmit with `force: true` to create a second loan after seeing `hasExistingLoan`. */
  force?: boolean;
  /** Resubmit with `acknowledgeBmpp: true` to proceed after seeing `bmppExceeded`. */
  acknowledgeBmpp?: boolean;
  disbursedAt?: string;
  /** KSU only: the lending unit; omitted = the tenant's default unit. */
  unitId?: string;
}

export interface PreviewScheduleRequest {
  loanConfigId: string;
  principalAmount: number;
  termMonths?: number;
  installmentCount?: number;
  rate?: number;
  disbursedAt?: string;
}

export interface PreviewScheduleResult {
  totalAmount: string;
  totalInterest: string;
  installments: Array<{ seq: number; dueDate: string; principalDue: string; interestDue: string }>;
}

/**
 * A member's room under the BMPP concentration limit (Permenkop UKM 8/2023
 * Pasal 44-45): 10% of Modal Sendiri for pengurus/pengawas (a hard block),
 * 15% for other members (a confirmable warning). A single-unit koperasi
 * measures against its consolidated Modal Sendiri; a KSU against the lending
 * unit's own, counting only that unit's loans. Decimal strings.
 */
export interface BmppHeadroom {
  basis: "KONSOLIDASI" | "UNIT";
  unitId: string | null;
  modalSendiri: string;
  isRelatedParty: boolean;
  limitPct: number;
  limit: string;
  /** Principal of the member's ACTIVE loans counted against the limit. */
  existingPrincipal: string;
  /** limit − existingPrincipal, never below 0. */
  headroom: string;
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
  | { hasExistingLoan: true; existingLoan: { id: string; principalAmount: string; remainingAmount: string } }
  /** Same 200-and-resubmit pattern, for a non-related-party loan over 15% of Modal Sendiri. */
  | { bmppExceeded: true; bmpp: BmppHeadroom & { requested: string } };

export interface LoanPaymentRequest {
  amount: number;
  penalty?: number;
  paidAt: string;
  note?: string;
}

export interface LoanPaymentResult {
  loanId: string;
  newRemaining: string;
  status: LoanStatus;
  kolCategory: KOLCategory;
  /** Installments this payment closed or partially covered, oldest first. */
  allocations: Array<{ installmentId: string; seq: number; principal: string; interest: string }>;
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
