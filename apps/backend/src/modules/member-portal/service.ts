import { db } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { getSavingById, listSavingTransactions, listSavings } from "../savings/service.js";
import { getLoanById, listLoans } from "../loans/service.js";
import type { ListSavingTransactionsQueryInput, ListSavingsQueryInput } from "../savings/schema.js";
import type { ListLoansQueryInput } from "../loans/schema.js";

/**
 * `getSavingById`/`getLoanById` only filter by tenantId (they trust the staff
 * caller) — a member-portal wrapper must add the ownership check itself, or a
 * member could view any other member's saving/loan just by guessing its id.
 * 404 (not 403) so existence of another member's record is never confirmed.
 */
function assertOwnsMember<T extends { memberId: string }>(record: T, memberId: string, message: string): T {
  if (record.memberId !== memberId) throw notFound(message);
  return record;
}

export async function getMemberDashboard(tenantId: string, memberId: string) {
  const [savingsTotal, loans] = await Promise.all([
    db.saving.aggregate({
      where: { tenantId, memberId, isActive: true },
      _sum: { balance: true },
      _count: true
    }),
    db.loan.aggregate({
      where: { tenantId, memberId, status: "ACTIVE" },
      _sum: { remainingAmount: true },
      _count: true
    })
  ]);

  return {
    totalSavingsBalance: (savingsTotal._sum.balance ?? 0).toString(),
    savingsAccountCount: savingsTotal._count,
    activeLoanCount: loans._count,
    totalLoanRemaining: (loans._sum.remainingAmount ?? 0).toString()
  };
}

// `query.memberId`, if a caller sneaks one into the query string, is
// overridden by the explicit `memberId` below — spread order matters here.
export function listMySavings(tenantId: string, memberId: string, query: ListSavingsQueryInput) {
  return listSavings(tenantId, { ...query, memberId });
}

export async function getMySaving(tenantId: string, memberId: string, id: string) {
  const saving = await getSavingById(tenantId, id);
  return assertOwnsMember(saving, memberId, "Rekening simpanan tidak ditemukan");
}

export async function listMySavingTransactions(
  tenantId: string,
  memberId: string,
  savingId: string,
  query: ListSavingTransactionsQueryInput
) {
  await getMySaving(tenantId, memberId, savingId);
  return listSavingTransactions(tenantId, savingId, query);
}

export function listMyLoans(tenantId: string, memberId: string, query: ListLoansQueryInput) {
  return listLoans(tenantId, { ...query, memberId });
}

export async function getMyLoan(tenantId: string, memberId: string, id: string) {
  const loan = await getLoanById(tenantId, id);
  return assertOwnsMember(loan, memberId, "Pinjaman tidak ditemukan");
}
