// Koperasi pasar plan (docs/2026-09-26-koperasi-pasar-dev-plan.md) F4.
export type CollectionBatchStatus = "OPEN" | "SUBMITTED" | "VERIFIED";

/** A member's assigned Kolektor. `userId` always references a User with the Kolektor role. */
export interface CollectorAssignment {
  id: string;
  tenantId: string;
  userId: string;
  memberId: string;
  createdAt: string;
}

export interface SetAssignmentsRequest {
  assignments: Array<{ memberId: string; collectorUserId: string }>;
}

/** One Kolektor's cash-in-hand for one operating day. */
export interface CollectionBatch {
  id: string;
  tenantId: string;
  collectorId: string;
  /** `YYYY-MM-DD` */
  businessDate: string;
  status: CollectionBatchStatus;
  expectedTotal: string;
  receivedTotal: string | null;
  variance: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  createdAt: string;
}

/** One open sewa/retribusi Charge on a binaan's "today" list (koperasi pasar F6). */
export interface CollectorTodayCharge {
  chargeId: string;
  kind: "SEWA" | "RETRIBUSI";
  dueDate: string;
  amountDue: string;
  daysOverdue: number;
}

/**
 * One binaan member's outstanding loan installment, open sewa/retribusi
 * charges, and daily-saving account (if any) on the collector's "today" list.
 */
export interface CollectorTodayItem {
  memberId: string;
  memberCode: string;
  memberName: string;
  loanId: string | null;
  installmentSeq: number | null;
  dueDate: string | null;
  amountDue: string | null;
  daysOverdue: number;
  charges: CollectorTodayCharge[];
  /** Their active DAILY-periodUnit saving account, if any — a voluntary deposit slot, not a due amount. */
  dailySavingId: string | null;
}

export interface CollectorDepositRequest {
  savingId: string;
  amount: number;
  note?: string;
}

export interface CollectorLoanPaymentRequest {
  loanId: string;
  amount: number;
  penalty?: number;
  note?: string;
}

export interface VerifyBatchRequest {
  receivedTotal: number;
}

export interface ListBatchesQuery {
  from?: string;
  to?: string;
  collectorId?: string;
  status?: CollectionBatchStatus;
}
