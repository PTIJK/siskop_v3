import { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { businessDate } from "../../lib/operating-calendar.js";
import { postCollectionBatchVerification } from "../../lib/journal.js";
import { depositToSaving } from "../savings/service.js";
import { recordLoanPayment } from "../loans/service.js";
import { payCharge } from "../market/charges.service.js";
import { recordAudit } from "../audit-log/service.js";
import type {
  CollectorChargePaymentInput,
  CollectorDepositInput,
  CollectorLoanPaymentInput,
  ListBatchesQueryInput,
  SetAssignmentsInput,
  VerifyBatchInput
} from "./schema.js";

// ── Assignments ───────────────────────────────────────────────────────────

/**
 * Bulk assign/reassign members to a Kolektor (Manager, PUT /assignments —
 * F4 plan). @@unique([tenantId, memberId]) on CollectorAssignment means a
 * member already assigned elsewhere is simply moved, not duplicated.
 */
export async function setAssignments(tenantId: string, data: SetAssignmentsInput) {
  return db.$transaction(async (tx) => {
    const results = [];
    for (const { memberId, collectorUserId } of data.assignments) {
      const member = await tx.member.findFirst({ where: { id: memberId, tenantId } });
      if (!member) throw notFound(`Anggota ${memberId} tidak ditemukan`);

      const collector = await tx.user.findFirst({ where: { id: collectorUserId, tenantId }, include: { role: true } });
      if (!collector) throw notFound(`Pengguna ${collectorUserId} tidak ditemukan`);
      if (collector.role.name !== "Kolektor") {
        throw validationError(`${collector.name} tidak memiliki role Kolektor`);
      }

      const existing = await tx.collectorAssignment.findFirst({ where: { tenantId, memberId } });
      const assignment = existing
        ? await tx.collectorAssignment.update({ where: { id: existing.id, tenantId }, data: { userId: collectorUserId } })
        : await tx.collectorAssignment.create({ data: { tenantId, memberId, userId: collectorUserId } });

      await recordAudit(tx, {
        action: "collectorAssignment.set",
        entityType: "CollectorAssignment",
        entityId: assignment.id,
        before: existing ? { userId: existing.userId } : undefined,
        after: { memberId, collectorUserId }
      });

      results.push(assignment);
    }
    return results;
  });
}

async function assertBinaan(tenantId: string, collectorUserId: string, memberId: string): Promise<void> {
  const assignment = await db.collectorAssignment.findFirst({ where: { tenantId, userId: collectorUserId, memberId } });
  if (!assignment) {
    throw new AppError(ErrorCode.NOT_ASSIGNED_COLLECTOR, "Anggota ini bukan binaan Anda");
  }
}

// ── Today's list ──────────────────────────────────────────────────────────

/**
 * A binaan's pasar location from their active StallContract (F5), or null for
 * a member who isn't a pasar trader — sorted last, by name, below.
 */
interface BinaanLocation {
  marketName: string;
  block: string | null;
  stallCode: string;
}

/** Pasar/blok/kode kios first (plan's "urut pasar/blok/kode kios"), stall-less binaan last by name. */
function compareByLocation(
  a: { location: BinaanLocation | null; memberName: string },
  b: { location: BinaanLocation | null; memberName: string }
): number {
  if (a.location && b.location) {
    return (
      a.location.marketName.localeCompare(b.location.marketName) ||
      (a.location.block ?? "").localeCompare(b.location.block ?? "") ||
      a.location.stallCode.localeCompare(b.location.stallCode)
    );
  }
  if (a.location && !b.location) return -1;
  if (!a.location && b.location) return 1;
  return a.memberName.localeCompare(b.memberName);
}

/**
 * The collector's binaan members plus their oldest UNPAID/PARTIAL loan
 * installment (if any), every open (UNPAID/PARTIAL) sewa/retribusi Charge
 * (koperasi pasar F6), and their active daily-saving account id (if any, for
 * the mobile "tabungan harian" quick-deposit slot — a voluntary deposit has
 * no fixed due amount, so unlike the other two this is just a pointer, not a
 * due-amount line). Sorted by pasar → blok → kode kios via each member's
 * active StallContract (F5 plan); a binaan with no stall contract sorts last,
 * by name.
 */
export async function getTodayForCollector(tenantId: string, collectorUserId: string) {
  const assignments = await db.collectorAssignment.findMany({
    where: { tenantId, userId: collectorUserId },
    include: {
      member: {
        select: {
          id: true,
          memberId: true,
          fullName: true,
          stallContracts: {
            where: { isActive: true },
            take: 1,
            select: { stall: { select: { code: true, block: true, market: { select: { name: true } } } } }
          },
          loans: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              installments: {
                where: { status: { not: "PAID" } },
                orderBy: { seq: "asc" },
                take: 1,
                select: { seq: true, dueDate: true, principalDue: true, interestDue: true, principalPaid: true, interestPaid: true }
              }
            },
            take: 1
          },
          charges: {
            where: { status: { not: "PAID" } },
            orderBy: { dueDate: "asc" },
            select: { id: true, kind: true, dueDate: true, amount: true, paidAmount: true }
          },
          savings: {
            where: { isActive: true, savingConfig: { periodUnit: "DAILY" } },
            take: 1,
            select: { id: true }
          }
        }
      }
    }
  });

  const today = businessDate();

  return assignments
    .map(({ member }) => {
      const loan = member.loans[0];
      const installment = loan?.installments[0];
      const amountDue = installment
        ? installment.principalDue.plus(installment.interestDue).sub(installment.principalPaid).sub(installment.interestPaid)
        : null;
      const daysOverdue =
        installment && installment.dueDate < today ? Math.floor((today.getTime() - installment.dueDate.getTime()) / 86_400_000) : 0;
      const stall = member.stallContracts[0]?.stall;

      return {
        location: stall ? { marketName: stall.market.name, block: stall.block, stallCode: stall.code } : null,
        memberName: member.fullName,
        memberId: member.id,
        memberCode: member.memberId,
        loanId: loan?.id ?? null,
        installmentSeq: installment?.seq ?? null,
        dueDate: installment ? installment.dueDate.toISOString().slice(0, 10) : null,
        amountDue: amountDue ? amountDue.toString() : null,
        daysOverdue,
        charges: member.charges.map((c) => ({
          chargeId: c.id,
          kind: c.kind,
          dueDate: c.dueDate.toISOString().slice(0, 10),
          amountDue: c.amount.sub(c.paidAmount).toString(),
          daysOverdue: c.dueDate < today ? Math.floor((today.getTime() - c.dueDate.getTime()) / 86_400_000) : 0
        })),
        dailySavingId: member.savings[0]?.id ?? null
      };
    })
    .sort(compareByLocation)
    .map(({ location: _location, ...item }) => item);
}

// ── Batches ───────────────────────────────────────────────────────────────

/**
 * Today's OPEN batch for this collector, creating one if none exists yet.
 * Throws BATCH_NOT_OPEN if today's batch has already moved past OPEN — a
 * collector cannot add a transaction after submitting (F4 plan "Aturan").
 *
 * Plain `db` calls, not a transaction: depositToSaving/recordLoanPayment
 * below open their own (each is already an atomic, self-contained unit —
 * audit + journal + balance update), so this can't be nested inside one
 * outer transaction without running it on a second, independent connection.
 * expectedTotal is incremented in a following statement, not this same one.
 */
async function ensureOpenBatchToday(tenantId: string, collectorId: string) {
  const today = businessDate();
  const existing = await db.collectionBatch.findFirst({ where: { tenantId, collectorId, businessDate: today } });
  if (existing) {
    if (existing.status !== "OPEN") {
      throw new AppError(ErrorCode.BATCH_NOT_OPEN, "Batch setoran hari ini sudah diserahkan/diverifikasi");
    }
    return existing;
  }
  return db.collectionBatch.create({ data: { tenantId, collectorId, businessDate: today, status: "OPEN" } });
}

export async function depositAsCollector(tenantId: string, collectorUserId: string, data: CollectorDepositInput) {
  const saving = await db.saving.findFirst({ where: { id: data.savingId, tenantId } });
  if (!saving) throw notFound("Rekening simpanan tidak ditemukan");
  await assertBinaan(tenantId, collectorUserId, saving.memberId);

  const batch = await ensureOpenBatchToday(tenantId, collectorUserId);
  const transaction = await depositToSaving(tenantId, data.savingId, { amount: data.amount, note: data.note }, collectorUserId, {
    batchId: batch.id
  });
  await db.collectionBatch.update({ where: { id: batch.id, tenantId }, data: { expectedTotal: { increment: data.amount } } });
  return transaction;
}

export async function payLoanAsCollector(tenantId: string, collectorUserId: string, data: CollectorLoanPaymentInput) {
  const loan = await db.loan.findFirst({ where: { id: data.loanId, tenantId } });
  if (!loan) throw notFound("Pinjaman tidak ditemukan");
  await assertBinaan(tenantId, collectorUserId, loan.memberId);

  const batch = await ensureOpenBatchToday(tenantId, collectorUserId);
  const result = await recordLoanPayment(
    tenantId,
    data.loanId,
    {
      amount: new Prisma.Decimal(data.amount),
      penalty: new Prisma.Decimal(data.penalty ?? 0),
      paidAt: businessDate().toISOString().slice(0, 10),
      note: data.note
    },
    collectorUserId,
    { batchId: batch.id }
  );
  await db.collectionBatch.update({ where: { id: batch.id, tenantId }, data: { expectedTotal: { increment: data.amount } } });
  return result;
}

/** A Kolektor paying a member's sewa/retribusi Charge in the field — same batch-accrual shape as depositAsCollector/payLoanAsCollector above. */
export async function payChargeAsCollector(tenantId: string, collectorUserId: string, data: CollectorChargePaymentInput) {
  const charge = await db.charge.findFirst({ where: { id: data.chargeId, tenantId } });
  if (!charge) throw notFound("Tagihan tidak ditemukan");
  await assertBinaan(tenantId, collectorUserId, charge.memberId);

  const batch = await ensureOpenBatchToday(tenantId, collectorUserId);
  const result = await payCharge(tenantId, data.chargeId, { amount: data.amount, note: data.note }, collectorUserId, {
    batchId: batch.id
  });
  await db.collectionBatch.update({ where: { id: batch.id, tenantId }, data: { expectedTotal: { increment: data.amount } } });
  return result;
}

export async function submitBatch(tenantId: string, collectorUserId: string, batchId: string) {
  return db.$transaction(async (tx) => {
    const batch = await tx.collectionBatch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw notFound("Batch tidak ditemukan");
    if (batch.collectorId !== collectorUserId) throw forbidden("Bukan batch Anda");
    if (batch.status !== "OPEN") throw conflict("Batch sudah diserahkan/diverifikasi");

    const updated = await tx.collectionBatch.update({
      where: { id: batchId, tenantId },
      data: { status: "SUBMITTED", submittedAt: new Date() }
    });

    await recordAudit(tx, {
      action: "collectionBatch.submit",
      entityType: "CollectionBatch",
      entityId: batchId,
      before: { status: batch.status },
      after: { status: "SUBMITTED" }
    });

    return updated;
  });
}

export async function verifyBatch(tenantId: string, verifierUserId: string, batchId: string, data: VerifyBatchInput) {
  return db.$transaction(async (tx) => {
    const batch = await tx.collectionBatch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw notFound("Batch tidak ditemukan");
    if (batch.collectorId === verifierUserId) throw forbidden("Tidak dapat memverifikasi setoran sendiri");
    if (batch.status !== "SUBMITTED") throw conflict("Batch belum diserahkan atau sudah diverifikasi");

    await postCollectionBatchVerification(tx, {
      tenantId,
      batchId,
      entryDate: new Date(),
      received: data.receivedTotal,
      expected: batch.expectedTotal,
      description: "Verifikasi setoran kolektor"
    });

    const received = new Prisma.Decimal(data.receivedTotal);
    const variance = received.sub(batch.expectedTotal);

    const updated = await tx.collectionBatch.update({
      where: { id: batchId, tenantId },
      data: { status: "VERIFIED", receivedTotal: received, variance, verifiedAt: new Date(), verifiedBy: verifierUserId }
    });

    await recordAudit(tx, {
      action: "collectionBatch.verify",
      entityType: "CollectionBatch",
      entityId: batchId,
      before: { status: batch.status, expectedTotal: batch.expectedTotal },
      after: { status: "VERIFIED", receivedTotal: received, variance }
    });

    return updated;
  });
}

export async function listBatches(tenantId: string, query: ListBatchesQueryInput) {
  return db.collectionBatch.findMany({
    where: {
      tenantId,
      ...(query.collectorId ? { collectorId: query.collectorId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            businessDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    },
    orderBy: { businessDate: "desc" }
  });
}
