import { Prisma, type ReferralPartner, type ReferralPartnerStatus } from "@prisma/client";
import type { ReferralCommissionRow, ReferralPartnerDetail, ReferralPartnerSummary, TenantReferralRow } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { writePricingAudit } from "../../lib/pricing/audit.js";
import { createUniqueReferralCode, isValidReferralCode, normalizeReferralCode } from "../../lib/referrals/code.js";
import { sendPartnerApprovedEmail, sendPartnerReceivedEmail, sendPartnerRejectedEmail } from "../../lib/referrals/emails.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { approvePartnerSchema, partnerApplicationSchema, partnerListQuerySchema, rejectPartnerSchema } from "./schema.js";

const REAPPLY_AFTER_MS = 30 * 86_400_000;
export const money = (d: Prisma.Decimal | null | undefined) => (d ?? new Prisma.Decimal(0)).toFixed(2);
const iso = (d: Date | null) => d?.toISOString() ?? null;


type ReferralWithTenant = Prisma.TenantReferralGetPayload<{ include: { tenant: { select: { id: true; name: true; slug: true; isActive: true } } } }>;
type CommissionWithRefs = Prisma.ReferralCommissionGetPayload<{
  include: { tenant: { select: { id: true; name: true } }; invoice: { select: { id: true; number: true; type: true } } };
}>;

export const REFERRAL_TENANT_SELECT = { id: true, name: true, slug: true, isActive: true } as const;

export function toReferralRow(r: ReferralWithTenant): TenantReferralRow {
  return {
    id: r.id,
    tenant: r.tenant,
    codeUsed: r.codeUsed,
    rate: r.rate.toFixed(4),
    months: r.months,
    attributedAt: r.attributedAt.toISOString(),
    windowEndsAt: r.windowEndsAt.toISOString(),
    source: r.source,
    flaggedSelfReferral: r.flaggedSelfReferral
  };
}

export function toCommissionRow(c: CommissionWithRefs): ReferralCommissionRow {
  return {
    id: c.id,
    tenant: c.tenant,
    invoice: c.invoice,
    baseAmount: money(c.baseAmount),
    rate: c.rate.toFixed(4),
    amount: money(c.amount),
    status: c.status,
    voidReason: c.voidReason,
    payoutId: c.payoutId,
    accruedAt: c.accruedAt.toISOString()
  };
}

/**
 * Public application. Always answers `received`: a duplicate of an open application
 * or an existing partner is dropped silently, so the endpoint cannot be used to find out
 * who has applied or what became of it.
 */
export async function applyAsPartner(input: unknown): Promise<{ received: true }> {
  const data = partnerApplicationSchema.parse(input);
  // acceptTerms and the honeypot are validated by the schema and are not stored.
  const { name, email, phone, city, province, ktpNo, npwp, bankName, bankAccountNo, bankAccountName, salesPlan, termsVersion } = data;
  const fields = { name, email, phone, city, province, ktpNo, npwp, bankName, bankAccountNo, bankAccountName, salesPlan, termsVersion };

  const created = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const taken = await tx.referralPartner.findFirst({
        where: {
          OR: [{ email: fields.email }, { phone: fields.phone }],
          NOT: { status: "REJECTED", reviewedAt: { lt: new Date(Date.now() - REAPPLY_AFTER_MS) } }
        },
        select: { id: true }
      });
      if (taken) return null;
      const settings = await tx.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } });
      return tx.referralPartner.create({
        data: {
          ...fields,
          termsAcceptedAt: new Date(),
          commissionRate: settings.referralDefaultRate,
          commissionMonths: settings.referralDefaultMonths,
          status: "PENDING",
          source: "APPLICATION"
        }
      });
    })
  );
  if (created) await sendPartnerReceivedEmail({ to: created.email, name: created.name });
  return { received: true };
}

type Aggregates = Pick<
  ReferralPartnerSummary,
  "referredTenants" | "referredRevenue" | "commissionAccrued" | "commissionPaid" | "commissionOutstanding"
>;

async function aggregates(partnerIds: string[]): Promise<(id: string) => Aggregates> {
  const [tenants, commissions] = await withoutTenantScope(async () =>
    Promise.all([
      db.tenantReferral.groupBy({ by: ["partnerId"], where: { partnerId: { in: partnerIds } }, _count: { _all: true } }),
      db.referralCommission.groupBy({
        by: ["partnerId", "status"],
        where: { partnerId: { in: partnerIds } },
        _sum: { amount: true, baseAmount: true }
      })
    ])
  );
  return (id) => {
    const sum = (status: string, field: "amount" | "baseAmount") =>
      commissions.find((c) => c.partnerId === id && c.status === status)?._sum[field] ?? new Prisma.Decimal(0);
    const accrued = sum("ACCRUED", "amount");
    const paid = sum("PAID", "amount");
    return {
      referredTenants: tenants.find((t) => t.partnerId === id)?._count._all ?? 0,
      // Voided commissions do not count as revenue the partner brought in.
      referredRevenue: money(sum("ACCRUED", "baseAmount").plus(sum("PAID", "baseAmount"))),
      commissionAccrued: money(accrued.plus(paid)),
      commissionPaid: money(paid),
      commissionOutstanding: money(accrued)
    };
  };
}

function summaryOf(p: ReferralPartner, agg: Aggregates): ReferralPartnerSummary {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    email: p.email,
    phone: p.phone,
    status: p.status,
    source: p.source,
    commissionRate: p.commissionRate.toFixed(4),
    commissionMonths: p.commissionMonths,
    createdAt: p.createdAt.toISOString(),
    ...agg
  };
}

/** Pending applications first, then newest first. */
export async function listPartners(query: unknown): Promise<ReferralPartnerSummary[]> {
  const { status } = partnerListQuerySchema.parse(query);
  const rows = await withoutTenantScope(async () =>
    db.referralPartner.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" } })
  );
  const agg = await aggregates(rows.map((r) => r.id));
  const rank = (s: ReferralPartnerStatus) => (s === "PENDING" ? 0 : 1);
  return rows.sort((a, b) => rank(a.status) - rank(b.status)).map((p) => summaryOf(p, agg(p.id)));
}

export async function getPartner(id: string): Promise<ReferralPartnerDetail> {
  const p = await withoutTenantScope(async () =>
    db.referralPartner.findUnique({
      where: { id },
      include: {
        referrals: { include: { tenant: { select: { id: true, name: true, slug: true, isActive: true } } }, orderBy: { attributedAt: "desc" } },
        commissions: {
          include: { tenant: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, type: true } } },
          orderBy: { accruedAt: "desc" }
        },
        payouts: { include: { _count: { select: { commissions: true } } }, orderBy: { createdAt: "desc" } }
      }
    })
  );
  if (!p) throw notFound("Mitra tidak ditemukan");
  const agg = (await aggregates([p.id]))(p.id);
  return {
    ...summaryOf(p, agg),
    city: p.city,
    province: p.province,
    ktpNo: p.ktpNo,
    npwp: p.npwp,
    bankName: p.bankName,
    bankAccountNo: p.bankAccountNo,
    bankAccountName: p.bankAccountName,
    salesPlan: p.salesPlan,
    termsVersion: p.termsVersion,
    termsAcceptedAt: iso(p.termsAcceptedAt),
    rejectReason: p.rejectReason,
    reviewedAt: iso(p.reviewedAt),
    notes: p.notes,
    referrals: p.referrals.map(toReferralRow),
    commissions: p.commissions.map(toCommissionRow),
    payouts: p.payouts.map((o) => ({
      id: o.id,
      number: o.number,
      partner: { id: p.id, name: p.name, code: p.code },
      periodEnd: o.periodEnd.toISOString(),
      grossAmount: money(o.grossAmount),
      taxWithheld: money(o.taxWithheld),
      netAmount: money(o.netAmount),
      status: o.status,
      transferRef: o.transferRef,
      paidAt: iso(o.paidAt),
      commissionCount: o._count.commissions,
      createdAt: o.createdAt.toISOString()
    }))
  };
}

/** PENDING to ACTIVE. The status guard in the update makes a double approval impossible, even under a race. */
export async function approvePartner(actorId: string, id: string, input: unknown): Promise<ReferralPartnerDetail> {
  const overrides = approvePartnerSchema.parse(input);
  let vanity: string | undefined;
  if (overrides.code) {
    vanity = normalizeReferralCode(overrides.code);
    if (!isValidReferralCode(vanity)) throw validationError("Kode referral tidak valid", { field: "code" });
  }

  const approved = await withoutTenantScope(async () => {
    try {
      return await db.$transaction(async (tx) => {
        const partner = await tx.referralPartner.findUnique({ where: { id } });
        if (!partner) throw notFound("Mitra tidak ditemukan");
        if (partner.status !== "PENDING") throw conflict("Hanya pendaftaran berstatus menunggu yang dapat disetujui");

        const exists = async (code: string) => (await tx.referralPartner.findUnique({ where: { code }, select: { id: true } })) !== null;
        if (vanity && (await exists(vanity))) throw conflict("Kode referral sudah dipakai");
        const code = vanity ?? (await createUniqueReferralCode(exists));

        const claimed = await tx.referralPartner.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "ACTIVE",
            code,
            reviewedById: actorId,
            reviewedAt: new Date(),
            ...(overrides.commissionRate !== undefined ? { commissionRate: new Prisma.Decimal(overrides.commissionRate) } : {}),
            ...(overrides.commissionMonths !== undefined ? { commissionMonths: overrides.commissionMonths } : {})
          }
        });
        if (claimed.count === 0) throw conflict("Pendaftaran ini sudah ditinjau");
        const after = await tx.referralPartner.findUniqueOrThrow({ where: { id } });
        await writePricingAudit(tx, {
          actorId,
          entity: "referral_partner",
          entityId: id,
          action: "APPROVED",
          before: { status: partner.status },
          after: { status: after.status, code, commissionRate: after.commissionRate.toString(), commissionMonths: after.commissionMonths }
        });
        return after;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Kode referral sudah dipakai");
      throw error;
    }
  });

  await sendPartnerApprovedEmail({
    to: approved.email,
    name: approved.name,
    code: approved.code ?? "",
    rate: approved.commissionRate.toString(),
    months: approved.commissionMonths
  });
  return getPartner(id);
}

/** PENDING to REJECTED with a reason the applicant is told. They may re-apply after 30 days. */
export async function rejectPartner(actorId: string, id: string, input: unknown): Promise<ReferralPartnerDetail> {
  const { reason } = rejectPartnerSchema.parse(input);
  const rejected = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const partner = await tx.referralPartner.findUnique({ where: { id } });
      if (!partner) throw notFound("Mitra tidak ditemukan");
      const claimed = await tx.referralPartner.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "REJECTED", rejectReason: reason, reviewedById: actorId, reviewedAt: new Date() }
      });
      if (claimed.count === 0) throw conflict("Hanya pendaftaran berstatus menunggu yang dapat ditolak");
      await writePricingAudit(tx, {
        actorId,
        entity: "referral_partner",
        entityId: id,
        action: "REJECTED",
        before: { status: partner.status },
        after: { status: "REJECTED", reason }
      });
      return partner;
    })
  );
  await sendPartnerRejectedEmail({ partnerId: id, to: rejected.email, name: rejected.name, reason });
  return getPartner(id);
}
