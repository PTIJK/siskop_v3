import { Prisma } from "@prisma/client";
import type { ReferralCommissionRow, ReferralPartnerDetail, ReferralSettings, TenantReferralRow } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { writePricingAudit } from "../../lib/pricing/audit.js";
import { referralWindowEnd } from "../../lib/referrals/accrue.js";
import { createUniqueReferralCode, isValidReferralCode, normalizeReferralCode } from "../../lib/referrals/code.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import {
  assignReferralSchema,
  createPartnerSchema,
  referralSettingsSchema,
  updatePartnerSchema,
  updateReferralSchema,
  voidCommissionSchema
} from "./schema.js";
import { getPartner, REFERRAL_TENANT_SELECT, toCommissionRow, toReferralRow } from "./service.js";

const dec = (value: string) => new Prisma.Decimal(value);
const emailOrPhone = (email: string | undefined, phone: string | undefined) => [
  ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
  ...(phone ? [{ phone }] : [])
];

/** Creates an ACTIVE partner recruited offline: code generated (or vanity), terms default to the program settings. */
export async function createPartner(actorId: string, input: unknown): Promise<ReferralPartnerDetail> {
  const { code: requestedCode, commissionRate, commissionMonths, ...fields } = createPartnerSchema.parse(input);
  let vanity: string | undefined;
  if (requestedCode) {
    vanity = normalizeReferralCode(requestedCode);
    if (!isValidReferralCode(vanity)) throw validationError("Kode referral tidak valid", { field: "code" });
  }

  const id = await withoutTenantScope(async () => {
    try {
      return await db.$transaction(async (tx) => {
        const dup = await tx.referralPartner.findFirst({ where: { OR: emailOrPhone(fields.email, fields.phone) }, select: { id: true } });
        if (dup) throw conflict("Email atau nomor WhatsApp sudah terdaftar sebagai mitra");
        const exists = async (code: string) => (await tx.referralPartner.findUnique({ where: { code }, select: { id: true } })) !== null;
        if (vanity && (await exists(vanity))) throw conflict("Kode referral sudah dipakai");
        const code = vanity ?? (await createUniqueReferralCode(exists));
        const settings = await tx.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } });
        const created = await tx.referralPartner.create({
          data: {
            ...fields,
            code,
            commissionRate: commissionRate ? dec(commissionRate) : settings.referralDefaultRate,
            commissionMonths: commissionMonths ?? settings.referralDefaultMonths,
            status: "ACTIVE",
            source: "ADMIN",
            createdById: actorId
          }
        });
        await writePricingAudit(tx, {
          actorId,
          entity: "referral_partner",
          entityId: created.id,
          action: "CREATED",
          after: { code, commissionRate: created.commissionRate.toString(), commissionMonths: created.commissionMonths }
        });
        return created.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Kode referral sudah dipakai");
      throw error;
    }
  });
  return getPartner(id);
}

const EDITABLE = ["name", "email", "phone", "city", "province", "npwp", "bankName", "bankAccountNo", "bankAccountName", "notes"] as const;

/**
 * Edits contact and bank data freely. Rate, months and status changes need a reason and
 * apply to koperasi referred from now on: snapshots on existing referrals never move.
 */
export async function updatePartner(actorId: string, id: string, input: unknown): Promise<ReferralPartnerDetail> {
  const { reason, status, commissionRate, commissionMonths, ...rest } = updatePartnerSchema.parse(input);

  await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const current = await tx.referralPartner.findUnique({ where: { id } });
      if (!current) throw notFound("Mitra tidak ditemukan");

      const rateChanged = commissionRate !== undefined && !dec(commissionRate).eq(current.commissionRate);
      const monthsChanged = commissionMonths !== undefined && commissionMonths !== current.commissionMonths;
      const statusChanged = status !== undefined && status !== current.status;
      if (rateChanged || monthsChanged || statusChanged) {
        if (current.status !== "ACTIVE" && current.status !== "SUSPENDED")
          throw conflict("Tarif dan status hanya dapat diubah untuk mitra aktif atau ditangguhkan");
        if (!reason) throw validationError("Alasan wajib diisi untuk perubahan komisi atau status", { field: "reason" });
      }

      const contactChanged = rest.email !== undefined && rest.email !== current.email.toLowerCase();
      const phoneChanged = rest.phone !== undefined && rest.phone !== current.phone;
      if (contactChanged || phoneChanged) {
        const dup = await tx.referralPartner.findFirst({
          where: { id: { not: id }, OR: emailOrPhone(contactChanged ? rest.email : undefined, phoneChanged ? rest.phone : undefined) },
          select: { id: true }
        });
        if (dup) throw conflict("Email atau nomor WhatsApp sudah dipakai mitra lain");
      }

      const data: Prisma.ReferralPartnerUpdateInput = {};
      const before: Record<string, string | number | null> = {};
      const after: Record<string, string | number | null> = {};
      for (const key of EDITABLE) {
        const next = rest[key];
        if (next !== undefined && next !== current[key]) {
          (data as Record<string, unknown>)[key] = next;
          before[key] = current[key];
          after[key] = next;
        }
      }
      if (rateChanged) {
        data.commissionRate = dec(commissionRate!);
        before.commissionRate = current.commissionRate.toString();
        after.commissionRate = dec(commissionRate!).toString();
      }
      if (monthsChanged) {
        data.commissionMonths = commissionMonths!;
        before.commissionMonths = current.commissionMonths;
        after.commissionMonths = commissionMonths!;
      }
      if (statusChanged) {
        data.status = status!;
        before.status = current.status;
        after.status = status!;
      }
      if (Object.keys(after).length === 0) return;

      await tx.referralPartner.update({ where: { id }, data });
      await writePricingAudit(tx, {
        actorId,
        entity: "referral_partner",
        entityId: id,
        action: "UPDATED",
        before,
        after: { ...after, ...(reason ? { reason } : {}) }
      });
    })
  );
  return getPartner(id);
}

const referralInclude = { tenant: { select: REFERRAL_TENANT_SELECT } } as const;

/**
 * Attaches a partner to a koperasi that has none (a deal closed offline), or moves it to another.
 * The snapshot restarts from now: commissions already earned stay with the partner who earned them.
 */
export async function assignTenantReferral(actorId: string, tenantId: string, input: unknown): Promise<TenantReferralRow> {
  const { partnerId, reason } = assignReferralSchema.parse(input);
  const row = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) throw notFound("Koperasi tidak ditemukan");
      const partner = await tx.referralPartner.findUnique({ where: { id: partnerId } });
      if (!partner) throw notFound("Mitra tidak ditemukan");
      if (partner.status !== "ACTIVE") throw conflict("Hanya mitra aktif yang dapat dikaitkan dengan koperasi");
      const existing = await tx.tenantReferral.findUnique({ where: { tenantId } });
      if (existing?.partnerId === partnerId) throw conflict("Koperasi ini sudah dirujuk oleh mitra tersebut");

      const selfReferral =
        (await tx.user.count({
          where: { tenantId, isActive: true, role: { name: "Super Admin" }, email: { equals: partner.email, mode: "insensitive" } }
        })) > 0;
      const attributedAt = new Date();
      const terms = {
        partnerId,
        codeUsed: partner.code ?? "",
        rate: partner.commissionRate,
        months: partner.commissionMonths,
        attributedAt,
        windowEndsAt: referralWindowEnd(attributedAt, partner.commissionMonths),
        source: "ADMIN" as const,
        flaggedSelfReferral: selfReferral,
        createdById: actorId
      };
      const saved = existing
        ? await tx.tenantReferral.update({ where: { id: existing.id }, data: terms, include: referralInclude })
        : await tx.tenantReferral.create({ data: { tenantId, ...terms }, include: referralInclude });
      await writePricingAudit(tx, {
        actorId,
        entity: "tenant_referral",
        entityId: saved.id,
        action: existing ? "REASSIGNED" : "ASSIGNED",
        ...(existing ? { before: { partnerId: existing.partnerId, rate: existing.rate.toString(), months: existing.months } } : {}),
        after: { partnerId, rate: partner.commissionRate.toString(), months: partner.commissionMonths, reason }
      });
      return saved;
    })
  );
  return toReferralRow(row);
}

/** Per-koperasi override: new rate and months apply to invoices paid after the change. */
export async function updateTenantReferral(actorId: string, id: string, input: unknown): Promise<TenantReferralRow> {
  const { rate, months, reason } = updateReferralSchema.parse(input);
  if (rate === undefined && months === undefined) throw validationError("Isi komisi atau masa komisi yang diubah");
  const row = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const current = await tx.tenantReferral.findUnique({ where: { id } });
      if (!current) throw notFound("Rujukan tidak ditemukan");
      const nextMonths = months ?? current.months;
      const saved = await tx.tenantReferral.update({
        where: { id },
        data: {
          ...(rate !== undefined ? { rate: dec(rate) } : {}),
          months: nextMonths,
          windowEndsAt: referralWindowEnd(current.attributedAt, nextMonths)
        },
        include: referralInclude
      });
      await writePricingAudit(tx, {
        actorId,
        entity: "tenant_referral",
        entityId: id,
        action: "TERMS_CHANGED",
        before: { rate: current.rate.toString(), months: current.months },
        after: { rate: saved.rate.toString(), months: saved.months, reason }
      });
      return saved;
    })
  );
  return toReferralRow(row);
}

const settingsOf = (s: { referralDefaultRate: Prisma.Decimal; referralDefaultMonths: number }): ReferralSettings => ({
  defaultRate: s.referralDefaultRate.toFixed(4),
  defaultMonths: s.referralDefaultMonths
});

export async function getReferralSettings(): Promise<ReferralSettings> {
  return settingsOf(await db.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } }));
}

/** Prefills new partners only; existing partners and referrals keep their own terms. */
export async function updateReferralSettings(actorId: string, input: unknown): Promise<ReferralSettings> {
  const { defaultRate, defaultMonths, reason } = referralSettingsSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } });
    const saved = await tx.pricingSetting.update({
      where: { id: "singleton" },
      data: { referralDefaultRate: dec(defaultRate), referralDefaultMonths: defaultMonths }
    });
    await writePricingAudit(tx, {
      actorId,
      entity: "referral_settings",
      entityId: "singleton",
      action: "UPDATED",
      before: { rate: before.referralDefaultRate.toString(), months: before.referralDefaultMonths },
      after: { rate: saved.referralDefaultRate.toString(), months: saved.referralDefaultMonths, reason }
    });
    return settingsOf(saved);
  });
}

/** A wrong commission is fixed by voiding it with a reason, never by editing the amount. Only ACCRUED rows can be voided. */
export async function voidCommission(actorId: string, id: string, input: unknown): Promise<ReferralCommissionRow> {
  const { reason } = voidCommissionSchema.parse(input);
  const row = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const claimed = await tx.referralCommission.updateMany({ where: { id, status: "ACCRUED", payoutId: null }, data: { status: "VOID", voidReason: reason } });
      if (claimed.count === 0) {
        const exists = await tx.referralCommission.findUnique({ where: { id }, select: { status: true, payoutId: true } });
        if (!exists) throw notFound("Komisi tidak ditemukan");
        if (exists.status === "ACCRUED" && exists.payoutId) throw conflict("Komisi ini ada di draf pembayaran. Batalkan draf pembayaran terlebih dahulu.");
        throw conflict("Hanya komisi berstatus terhutang yang dapat dibatalkan");
      }
      await writePricingAudit(tx, { actorId, entity: "referral_commission", entityId: id, action: "VOIDED", before: { status: "ACCRUED" }, after: { status: "VOID", reason } });
      return tx.referralCommission.findUniqueOrThrow({
        where: { id },
        include: { tenant: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, type: true } } }
      });
    })
  );
  return toCommissionRow(row);
}
