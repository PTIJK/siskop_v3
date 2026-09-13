import { Prisma } from "@prisma/client";
import type { Member } from "@prisma/client";
import { db } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import { postMemberCreditRepayment } from "../../lib/journal.js";
import { listMembers } from "../members/service.js";
import type { ListOutstandingCreditQueryInput, RecordCreditRepaymentInput } from "./credit.schema.js";

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

/** Shared by getMemberCreditStatus (one member) and listOutstandingMemberCredit (batched) so the limit/outstanding/eligibility formula lives in exactly one place. */
function buildCreditStatus(
  member: Pick<Member, "id" | "fullName">,
  savingsBalance: Prisma.Decimal,
  hasActiveSaving: boolean,
  charged: Prisma.Decimal,
  repaid: Prisma.Decimal
): MemberCreditStatus {
  const creditLimit = savingsBalance.mul(CREDIT_LIMIT_RATIO);
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
  const charged = chargeAgg._sum.totalPrice ?? new Prisma.Decimal(0);
  const repaid = repaymentAgg._sum.amount ?? new Prisma.Decimal(0);

  return buildCreditStatus(member, savingsBalance, hasActiveSaving, charged, repaid);
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

export interface MemberCreditSummary extends MemberCreditStatus {
  memberNumber: string;
  accountNumber: string;
}

export function toWireCreditSummary(row: MemberCreditSummary) {
  return {
    ...toWireStatus(row),
    memberNumber: row.memberNumber,
    accountNumber: row.accountNumber
  };
}

/**
 * Tenant-wide "Piutang Anggota" list — every member with an outstanding
 * MEMBER_CREDIT balance, for the dedicated monitoring/repayment screen
 * (getMemberCreditStatus above only ever looks at one member at a time).
 * Same "derive, don't cache" approach, just batched: group POSSale/
 * MemberCreditRepayment/Saving by memberId instead of aggregating per
 * member one at a time, then filter/search/sort/paginate in memory — the
 * candidate set is bounded by how many members have ever used store credit,
 * not the tenant's full member roster, so this stays small at koperasi
 * scale (same assumption listMembers-style DB-level pagination would trade
 * away for a filter that can't be expressed as a single Prisma query).
 */
export async function listOutstandingMemberCredit(tenantId: string, query: ListOutstandingCreditQueryInput) {
  const { page, limit, search } = query;

  const [chargeGroups, repaymentGroups] = await Promise.all([
    db.pOSSale.groupBy({
      by: ["memberId"],
      where: { tenantId, paymentMethod: "MEMBER_CREDIT", memberId: { not: null } },
      _sum: { totalPrice: true }
    }),
    db.memberCreditRepayment.groupBy({
      by: ["memberId"],
      where: { tenantId },
      _sum: { amount: true }
    })
  ]);

  const chargedMap = new Map<string, Prisma.Decimal>();
  for (const g of chargeGroups) {
    if (g.memberId) chargedMap.set(g.memberId, g._sum.totalPrice ?? new Prisma.Decimal(0));
  }
  const repaidMap = new Map<string, Prisma.Decimal>();
  for (const g of repaymentGroups) {
    repaidMap.set(g.memberId, g._sum.amount ?? new Prisma.Decimal(0));
  }

  const candidateIds = Array.from(new Set([...chargedMap.keys(), ...repaidMap.keys()]));
  if (candidateIds.length === 0) {
    return { items: [] as MemberCreditSummary[], meta: { page, limit, total: 0, totalOutstanding: new Prisma.Decimal(0) } };
  }

  const [savingsGroups, members] = await Promise.all([
    db.saving.groupBy({
      by: ["memberId"],
      where: { tenantId, memberId: { in: candidateIds }, isActive: true },
      _sum: { balance: true },
      _count: true
    }),
    db.member.findMany({ where: { tenantId, id: { in: candidateIds } } })
  ]);

  const savingsMap = new Map<string, { balance: Prisma.Decimal; hasActiveSaving: boolean }>();
  for (const g of savingsGroups) {
    savingsMap.set(g.memberId, { balance: g._sum.balance ?? new Prisma.Decimal(0), hasActiveSaving: g._count > 0 });
  }

  const outstandingOnly: MemberCreditSummary[] = members
    .map((member) => {
      const savings = savingsMap.get(member.id);
      const charged = chargedMap.get(member.id) ?? new Prisma.Decimal(0);
      const repaid = repaidMap.get(member.id) ?? new Prisma.Decimal(0);
      const status = buildCreditStatus(member, savings?.balance ?? new Prisma.Decimal(0), savings?.hasActiveSaving ?? false, charged, repaid);
      return { ...status, memberNumber: member.memberId, accountNumber: member.accountNumber };
    })
    .filter((row) => row.outstandingBalance.gt(0));

  const totalOutstanding = outstandingOnly.reduce((sum, row) => sum.add(row.outstandingBalance), new Prisma.Decimal(0));

  const searchTerm = search?.trim().toLowerCase();
  const filtered = searchTerm
    ? outstandingOnly.filter(
        (row) => row.fullName.toLowerCase().includes(searchTerm) || row.memberNumber.toLowerCase().includes(searchTerm)
      )
    : outstandingOnly;

  filtered.sort((a, b) => b.outstandingBalance.comparedTo(a.outstandingBalance));

  const items = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

  return { items, meta: { page, limit, total: filtered.length, totalOutstanding } };
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
