import type { Prisma, ReferralPartner } from "@prisma/client";
import type { TxClient } from "../db.js";
import { db } from "../db.js";
import { withoutTenantScope } from "../tenant-scope.js";
import { referralWindowEnd } from "./accrue.js";
import { isValidReferralCode, normalizeReferralCode } from "./code.js";

type Client = Pick<typeof db, "referralPartner"> | TxClient;

/** The partner behind a typed code, or null. Only ACTIVE partners accept new sign-ups. */
export async function findActivePartnerByCode(client: Client, input: string): Promise<ReferralPartner | null> {
  const code = normalizeReferralCode(input);
  if (!isValidReferralCode(code)) return null;
  const partner = await withoutTenantScope(async () => client.referralPartner.findUnique({ where: { code } }));
  return partner?.status === "ACTIVE" ? partner : null;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Locks a new koperasi to a partner, snapshotting the partner's current rate and
 * window. A partner whose email matches the Super Admin's is flagged for review,
 * not blocked.
 */
export async function attributeRegistration(
  tx: TxClient,
  input: { tenantId: string; partner: ReferralPartner; adminEmail: string; now?: Date }
) {
  const { partner, tenantId, adminEmail } = input;
  const attributedAt = input.now ?? new Date();
  const data: Prisma.TenantReferralUncheckedCreateInput = {
    tenantId,
    partnerId: partner.id,
    codeUsed: partner.code ?? "",
    rate: partner.commissionRate,
    months: partner.commissionMonths,
    attributedAt,
    windowEndsAt: referralWindowEnd(attributedAt, partner.commissionMonths),
    source: "REGISTRATION",
    flaggedSelfReferral: same(partner.email, adminEmail)
  };
  return withoutTenantScope(async () => tx.tenantReferral.create({ data }));
}
