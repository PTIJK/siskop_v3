import { Prisma } from "@prisma/client";
import type { ReferralPayoutRow } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { safeText, toCsv } from "../../lib/csv.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { writePricingAudit } from "../../lib/pricing/audit.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { cancelPayoutSchema, createPayoutSchema, markPayoutPaidSchema, payoutListQuerySchema, statementQuerySchema } from "./schema.js";
import { money } from "./service.js";

const WIB = "+07:00";
/** A cutoff date means the end of that day in Jakarta, so a commission earned late that evening is still in. */
const endOfDayWib = (date: string) => new Date(`${date}T23:59:59.999${WIB}`);
const startOfDayWib = (date: string) => new Date(`${date}T00:00:00.000${WIB}`);
const wibDate = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

const payoutInclude = { partner: { select: { id: true, name: true, code: true } }, _count: { select: { commissions: true } } } as const;
type PayoutWithRefs = Prisma.ReferralPayoutGetPayload<{ include: typeof payoutInclude }>;

export function toPayoutRow(o: PayoutWithRefs): ReferralPayoutRow {
  return {
    id: o.id,
    number: o.number,
    partner: o.partner,
    periodEnd: o.periodEnd.toISOString(),
    grossAmount: money(o.grossAmount),
    taxWithheld: money(o.taxWithheld),
    netAmount: money(o.netAmount),
    status: o.status,
    transferRef: o.transferRef,
    paidAt: o.paidAt?.toISOString() ?? null,
    commissionCount: o._count.commissions,
    createdAt: o.createdAt.toISOString()
  };
}

export async function listPayouts(query: unknown): Promise<ReferralPayoutRow[]> {
  const { status, partnerId } = payoutListQuerySchema.parse(query);
  const rows = await withoutTenantScope(async () =>
    db.referralPayout.findMany({
      where: { ...(status ? { status } : {}), ...(partnerId ? { partnerId } : {}) },
      include: payoutInclude,
      orderBy: { createdAt: "desc" }
    })
  );
  return rows.map(toPayoutRow);
}

async function nextNumber(tx: TxClient, now: Date): Promise<string> {
  const prefix = `PO-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}-`;
  const last = await tx.referralPayout.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const seq = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Batches a partner's ACCRUED commissions up to the cutoff day into a DRAFT payout. Commissions
 * are linked to it at once, so two drafts can never claim the same commission.
 */
export async function createPayout(actorId: string, input: unknown): Promise<ReferralPayoutRow> {
  const { partnerId, periodEnd } = createPayoutSchema.parse(input);
  const cutoff = endOfDayWib(periodEnd);
  try {
    const row = await withoutTenantScope(async () =>
      db.$transaction(async (tx) => {
        if (!(await tx.referralPartner.findUnique({ where: { id: partnerId }, select: { id: true } }))) throw notFound("Mitra tidak ditemukan");
        const due = await tx.referralCommission.findMany({
          where: { partnerId, status: "ACCRUED", payoutId: null, accruedAt: { lte: cutoff } },
          select: { id: true, amount: true }
        });
        if (due.length === 0) throw validationError("Tidak ada komisi terhutang sampai tanggal tersebut", { field: "periodEnd" });
        const gross = due.reduce((sum, c) => sum.plus(c.amount), new Prisma.Decimal(0));

        const payout = await tx.referralPayout.create({
          data: {
            number: await nextNumber(tx, new Date()),
            partnerId,
            periodEnd: cutoff,
            grossAmount: gross,
            taxWithheld: 0,
            netAmount: gross,
            status: "DRAFT",
            createdById: actorId
          }
        });
        const linked = await tx.referralCommission.updateMany({
          where: { id: { in: due.map((c) => c.id) }, status: "ACCRUED", payoutId: null },
          data: { payoutId: payout.id }
        });
        if (linked.count !== due.length) throw conflict("Komisi berubah saat pembayaran dibuat. Coba lagi.");
        await writePricingAudit(tx, {
          actorId,
          entity: "referral_payout",
          entityId: payout.id,
          action: "CREATED",
          after: { number: payout.number, partnerId, periodEnd, gross: gross.toString(), commissions: due.length }
        });
        return tx.referralPayout.findUniqueOrThrow({ where: { id: payout.id }, include: payoutInclude });
      })
    );
    return toPayoutRow(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Nomor pembayaran bentrok. Coba lagi.");
    throw error;
  }
}

/** DRAFT to PAID after the bank transfer: records the reference and tax, and settles the commissions. */
export async function markPayoutPaid(actorId: string, id: string, input: unknown): Promise<ReferralPayoutRow> {
  const { transferRef, paidAt, taxWithheld } = markPayoutPaidSchema.parse(input);
  const row = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const payout = await tx.referralPayout.findUnique({ where: { id } });
      if (!payout) throw notFound("Pembayaran tidak ditemukan");
      const tax = new Prisma.Decimal(taxWithheld ?? 0);
      if (tax.gt(payout.grossAmount)) throw validationError("Pajak tidak boleh melebihi jumlah kotor", { field: "taxWithheld" });
      const net = payout.grossAmount.minus(tax);

      const claimed = await tx.referralPayout.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "PAID", transferRef, paidAt: paidAt ? new Date(paidAt) : new Date(), paidById: actorId, taxWithheld: tax, netAmount: net }
      });
      if (claimed.count === 0) throw conflict("Hanya pembayaran berstatus draf yang dapat ditandai dibayar");
      await tx.referralCommission.updateMany({ where: { payoutId: id, status: "ACCRUED" }, data: { status: "PAID" } });
      await writePricingAudit(tx, {
        actorId,
        entity: "referral_payout",
        entityId: id,
        action: "PAID",
        before: { status: "DRAFT" },
        after: { status: "PAID", transferRef, taxWithheld: tax.toString(), net: net.toString() }
      });
      return tx.referralPayout.findUniqueOrThrow({ where: { id }, include: payoutInclude });
    })
  );
  return toPayoutRow(row);
}

/** Cancels a DRAFT. Its commissions stay ACCRUED and become available to the next payout. */
export async function cancelPayout(actorId: string, id: string, input: unknown): Promise<ReferralPayoutRow> {
  const { reason } = cancelPayoutSchema.parse(input ?? {});
  const row = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const claimed = await tx.referralPayout.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CANCELLED" } });
      if (claimed.count === 0) {
        if (!(await tx.referralPayout.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Pembayaran tidak ditemukan");
        throw conflict("Hanya pembayaran berstatus draf yang dapat dibatalkan");
      }
      await tx.referralCommission.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
      await writePricingAudit(tx, {
        actorId,
        entity: "referral_payout",
        entityId: id,
        action: "CANCELLED",
        before: { status: "DRAFT" },
        after: { status: "CANCELLED", ...(reason ? { reason } : {}) }
      });
      return tx.referralPayout.findUniqueOrThrow({ where: { id }, include: payoutInclude });
    })
  );
  return toPayoutRow(row);
}

const HEADER = ["Tanggal", "Koperasi", "Faktur", "Dasar", "Tarif", "Komisi", "Status", "Pembayaran"];

/** Statement sent to a partner by hand: commissions accrued in the period, or all of them without one. */
export async function partnerStatementCsv(partnerId: string, query: unknown): Promise<{ filename: string; csv: string }> {
  const { from, to } = statementQuerySchema.parse(query);
  const { partner, rows } = await withoutTenantScope(async () => {
    const found = await db.referralPartner.findUnique({ where: { id: partnerId }, select: { code: true } });
    if (!found) throw notFound("Mitra tidak ditemukan");
    const commissions = await db.referralCommission.findMany({
      where: {
        partnerId,
        ...(from || to ? { accruedAt: { ...(from ? { gte: startOfDayWib(from) } : {}), ...(to ? { lte: endOfDayWib(to) } : {}) } } : {})
      },
      include: { tenant: { select: { name: true } }, invoice: { select: { number: true } }, payout: { select: { number: true } } },
      orderBy: { accruedAt: "asc" }
    });
    return { partner: found, rows: commissions };
  });
  const body = rows.map((c) => [
    wibDate(c.accruedAt),
    safeText(c.tenant.name),
    c.invoice.number,
    c.baseAmount.toFixed(2),
    `${Number((Number(c.rate) * 100).toFixed(2))}%`,
    c.amount.toFixed(2),
    c.status,
    c.payout?.number ?? ""
  ]);
  const period = from || to ? `${from ?? "awal"}_${to ?? "kini"}` : "semua";
  return { filename: `statement-${partner.code ?? "mitra"}-${period}.csv`, csv: toCsv([HEADER, ...body]) };
}
