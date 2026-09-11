import { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import { postMemberCreditRepayment } from "../../lib/journal.js";
import { listMembers } from "../members/service.js";
import type { RecordCreditRepaymentInput } from "./credit.schema.js";

// A member-credit ("Kredit Anggota") sale is a receivable, not cash-in-hand —
// see lib/journal.ts#postPosSale's SALE_RECEIVABLE branch. Nothing here is
// cached: creditLimit and outstandingBalance are both derived fresh from
// Saving/POSSale/MemberCreditRepayment rows every call, the same "derive,
// don't cache" approach Saving.balance's own transaction ledger uses.
const CREDIT_LIMIT_RATIO = 0.5;

export interface MemberCreditStatus {
  memberId: string;
  fullName: string;
  savingsBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal;
  outstandingBalance: Prisma.Decimal;
  availableCredit: Prisma.Decimal;
  hasActiveSaving: boolean;
  eligible: boolean;
}

/**
 * creditLimit is auto-computed (50% of the member's total active savings
 * balance across every saving type), never a manually-set field — a member
 * is eligible only when they have at least one active saving AND that
 * derived limit is positive. Callers needing the wire shape (Decimal ->
 * string) should go through toWireStatus below.
 */
export async function getMemberCreditStatus(tenantId: string, memberId: string): Promise<MemberCreditStatus> {
  const member = await db.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const [savingsAgg, chargeAgg, repaymentAgg] = await Promise.all([
    db.saving.aggregate({ where: { tenantId, memberId, isActive: true }, _sum: { balance: true }, _count: true }),
    db.pOSSale.aggregate({ where: { tenantId, memberId, paymentMethod: "MEMBER_CREDIT" }, _sum: { totalPrice: true } }),
    db.memberCreditRepayment.aggregate({ where: { tenantId, memberId }, _sum: { amount: true } })
  ]);

  const savingsBalance = savingsAgg._sum.balance ?? new Prisma.Decimal(0);
  const hasActiveSaving = savingsAgg._count > 0;
  const creditLimit = savingsBalance.mul(CREDIT_LIMIT_RATIO);
  const charged = chargeAgg._sum.totalPrice ?? new Prisma.Decimal(0);
  const repaid = repaymentAgg._sum.amount ?? new Prisma.Decimal(0);
  const outstandingBalance = charged.sub(repaid);
  const availableCredit = creditLimit.sub(outstandingBalance);

  return {
    memberId: member.id,
    fullName: member.fullName,
    savingsBalance,
    creditLimit,
    outstandingBalance,
    availableCredit,
    hasActiveSaving,
    eligible: hasActiveSaving && creditLimit.gt(0)
  };
}

export function toWireStatus(status: MemberCreditStatus) {
  return {
    memberId: status.memberId,
    fullName: status.fullName,
    savingsBalance: status.savingsBalance.toString(),
    creditLimit: status.creditLimit.toString(),
    outstandingBalance: status.outstandingBalance.toString(),
    availableCredit: status.availableCredit.toString(),
    hasActiveSaving: status.hasActiveSaving,
    eligible: status.eligible
  };
}

/**
 * Reuses members/service.ts#listMembers rather than duplicating its search
 * query — the point of a separate konsumen-scoped endpoint is the
 * konsumen:read permission gate at the route layer (see credit.routes.ts),
 * not a different search implementation. A Kasir role typically has
 * konsumen but not members permissions, and still needs to look a member up
 * at the register.
 */
export async function searchMembersForCredit(tenantId: string, search: string) {
  const { items } = await listMembers(tenantId, {
    page: 1,
    limit: 5,
    search,
    sortBy: "fullName",
    sortOrder: "asc"
  });
  return items.map((m) => ({ id: m.id, fullName: m.fullName, memberId: m.memberId, accountNumber: m.accountNumber }));
}

export async function recordCreditRepayment(tenantId: string, data: RecordCreditRepaymentInput, createdBy: string) {
  const status = await getMemberCreditStatus(tenantId, data.memberId);
  const amount = new Prisma.Decimal(data.amount);
  if (amount.gt(status.outstandingBalance)) {
    throw validationError("Jumlah pembayaran melebihi sisa kredit anggota");
  }

  return db.$transaction(async (tx) => {
    const repayment = await tx.memberCreditRepayment.create({
      data: { tenantId, memberId: data.memberId, amount, note: data.note, createdBy }
    });

    await postMemberCreditRepayment(tx, {
      tenantId,
      repaymentId: repayment.id,
      amount: amount.toNumber(),
      entryDate: repayment.createdAt,
      description: "Pembayaran kredit anggota"
    });

    return { id: repayment.id, outstandingBalance: status.outstandingBalance.sub(amount).toString() };
  });
}
