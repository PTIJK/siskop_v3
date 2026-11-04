import { Prisma, type ReferralPartnerStatus } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { referralWindowEnd } from "../src/lib/referrals/accrue.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";

let seq = 0;

/** Referral rows hold Restrict FKs to tenants and invoices, so they go before any tenant cleanup. */
export async function cleanReferrals() {
  await withoutTenantScope(async () => {
    await db.referralCommission.deleteMany({});
    await db.referralPayout.deleteMany({});
    await db.tenantReferral.deleteMany({});
    await db.referralPartner.deleteMany({});
  });
}

export async function makePartner(opts: { status?: ReferralPartnerStatus; code?: string | null; rate?: string; months?: number; email?: string; phone?: string } = {}) {
  seq++;
  return db.referralPartner.create({
    data: {
      code: opts.code === undefined ? `NEX-TEST${String(seq).padStart(3, "0")}` : opts.code,
      name: `Mitra ${seq}`,
      email: opts.email ?? `mitra${seq}@partner.example`,
      phone: opts.phone ?? `0812000${String(seq).padStart(5, "0")}`,
      ktpNo: "3201010101010001",
      bankName: "BCA",
      bankAccountNo: "1234567890",
      bankAccountName: `Mitra ${seq}`,
      commissionRate: new Prisma.Decimal(opts.rate ?? "0.2"),
      commissionMonths: opts.months ?? 12,
      status: opts.status ?? "ACTIVE",
      source: "ADMIN"
    }
  });
}

/** Attributes `tenantId` to a partner with its own snapshotted rate and window. */
export async function makeReferral(
  tenantId: string,
  opts: { partnerId?: string; rate?: string; months?: number; attributedAt?: Date; partnerStatus?: ReferralPartnerStatus } = {}
) {
  const partner = opts.partnerId
    ? await db.referralPartner.findUniqueOrThrow({ where: { id: opts.partnerId } })
    : await makePartner({ status: opts.partnerStatus });
  const attributedAt = opts.attributedAt ?? new Date("2026-01-01T00:00:00.000Z");
  const months = opts.months ?? partner.commissionMonths;
  const referral = await withoutTenantScope(async () =>
    db.tenantReferral.create({
      data: {
        tenantId,
        partnerId: partner.id,
        codeUsed: partner.code ?? "NEX-NONE",
        rate: opts.rate ? new Prisma.Decimal(opts.rate) : partner.commissionRate,
        months,
        attributedAt,
        windowEndsAt: referralWindowEnd(attributedAt, months),
        source: "REGISTRATION"
      }
    })
  );
  return { partner, referral };
}

export const commissionsOf = (tenantId: string) =>
  withoutTenantScope(async () => db.referralCommission.findMany({ where: { tenantId }, orderBy: { accruedAt: "asc" } }));
