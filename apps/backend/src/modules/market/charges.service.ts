import { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { postChargePayment } from "../../lib/journal.js";
import { recordAudit } from "../audit-log/service.js";
import type { ListChargesQueryInput, PayChargeInput } from "./charges.schema.js";

export async function listCharges(tenantId: string, query: ListChargesQueryInput) {
  const charges = await db.charge.findMany({
    where: {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.marketId || query.block
        ? {
            stall: {
              ...(query.marketId ? { marketId: query.marketId } : {}),
              ...(query.block ? { block: query.block } : {})
            }
          }
        : {})
    },
    include: {
      member: { select: { fullName: true } },
      stall: { select: { code: true, block: true, marketId: true, market: { select: { name: true } } } }
    },
    orderBy: [{ dueDate: "asc" }]
  });

  return charges.map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    unitId: c.unitId,
    memberId: c.memberId,
    memberName: c.member.fullName,
    stallId: c.stallId,
    stallCode: c.stall.code,
    marketId: c.stall.marketId,
    marketName: c.stall.market.name,
    block: c.stall.block,
    kind: c.kind,
    periodStart: c.periodStart,
    dueDate: c.dueDate,
    amount: c.amount,
    paidAmount: c.paidAmount,
    status: c.status,
    createdAt: c.createdAt
  }));
}

/**
 * Records a ChargePayment and books it (Dr Kas or Kas di Kolektor / Cr
 * Piutang Sewa & Retribusi — see lib/journal.ts#postChargePayment).
 * `collector` mirrors recordLoanPayment's own param (modules/loans/service.ts):
 * set by modules/collections/service.ts when a Kolektor collects a levy in
 * the field, redirecting the Kas side and tagging the payment to their batch.
 */
export async function payCharge(
  tenantId: string,
  chargeId: string,
  data: PayChargeInput,
  createdBy: string,
  collector?: { batchId: string }
) {
  return db.$transaction(async (tx) => {
    const charge = await tx.charge.findFirst({ where: { id: chargeId, tenantId } });
    if (!charge) throw notFound("Tagihan tidak ditemukan");

    const amount = new Prisma.Decimal(data.amount);
    const remaining = charge.amount.sub(charge.paidAmount);
    if (amount.gt(remaining)) {
      throw new AppError(ErrorCode.PAYMENT_EXCEEDS_REMAINING, "Nominal bayar melebihi sisa tagihan");
    }

    const paidAt = new Date();
    const payment = await tx.chargePayment.create({
      data: {
        tenantId,
        chargeId,
        amount,
        paidAt,
        createdBy,
        collectionBatchId: collector?.batchId ?? null
      }
    });

    await postChargePayment(tx, {
      tenantId,
      unitId: charge.unitId,
      chargePaymentId: payment.id,
      amount,
      entryDate: paidAt,
      description: charge.kind === "SEWA" ? "Pembayaran sewa kios" : "Pembayaran retribusi",
      viaCollector: !!collector
    });

    const newPaidAmount = charge.paidAmount.add(amount);
    const newStatus = newPaidAmount.gte(charge.amount) ? ("PAID" as const) : ("PARTIAL" as const);

    const updated = await tx.charge.update({
      where: { id: chargeId, tenantId },
      data: { paidAmount: newPaidAmount, status: newStatus }
    });

    await recordAudit(tx, {
      action: "charge.pay",
      entityType: "Charge",
      entityId: chargeId,
      before: { paidAmount: charge.paidAmount.toString(), status: charge.status },
      after: { paidAmount: updated.paidAmount.toString(), status: updated.status }
    });

    return updated;
  });
}
