import type { Prisma } from "@prisma/client";
import type { AuditThresholdCheckResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { MODAL_DISETOR_AUDIT_THRESHOLD_RP } from "../../lib/regulatory-config.js";
import { createTenantNotification } from "../notifications/service.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 1 January 00:00 WIB of `asOf`'s calendar year in Indonesia, as a UTC instant. */
function startOfWibYear(asOf: Date): Date {
  const wibYear = new Date(asOf.getTime() + WIB_OFFSET_MS).getUTCFullYear();
  return new Date(Date.UTC(wibYear, 0, 1) - WIB_OFFSET_MS);
}

/** "5000000000.5" → "Rp5.000.000.000,50" — string-based, so no float rounding. */
function rupiah(value: Prisma.Decimal): string {
  const [whole = "0", fraction = "00"] = value.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp${grouped}${fraction === "00" ? "" : `,${fraction}`}`;
}

/**
 * Daily Permenkop UKM No. 2/2024 Pasal 12 reminder: raises one tenant bell
 * notification per calendar year (WIB) for each tenant whose modal disetor has
 * reached the Rp5 miliar mandatory-audit threshold. A reminder only — nothing
 * is blocked. `tenantId` narrows the sweep to one tenant (tests).
 *
 * The stamp is claimed with a conditional updateMany inside the same
 * transaction as the notification, so overlapping runs or Cloud Scheduler
 * retries can never notify a tenant twice in one year.
 */
export async function checkAuditThreshold(asOf: Date = new Date(), tenantId?: string): Promise<AuditThresholdCheckResult> {
  const yearStart = startOfWibYear(asOf);
  const notNotifiedThisYear = {
    OR: [{ auditThresholdNotifiedAt: null }, { auditThresholdNotifiedAt: { lt: yearStart } }]
  };

  const tenants = await db.tenant.findMany({
    where: {
      modalDisetor: { gte: MODAL_DISETOR_AUDIT_THRESHOLD_RP },
      ...(tenantId ? { id: tenantId } : {})
    },
    select: { id: true, name: true, modalDisetor: true }
  });

  const result: AuditThresholdCheckResult = { checked: tenants.length, notified: 0, failed: 0 };
  for (const tenant of tenants) {
    try {
      const notified = await db.$transaction(async (tx) => {
        const claimed = await tx.tenant.updateMany({
          where: { id: tenant.id, ...notNotifiedThisYear },
          data: { auditThresholdNotifiedAt: asOf }
        });
        if (claimed.count === 0) return false;

        await createTenantNotification(tx, {
          tenantId: tenant.id,
          type: "AUDIT_THRESHOLD_EXCEEDED",
          title: "Ambang audit wajib tercapai",
          message:
            `Modal disetor ${tenant.name} sebesar ${rupiah(tenant.modalDisetor!)} telah mencapai ambang ` +
            `${rupiah(MODAL_DISETOR_AUDIT_THRESHOLD_RP)} — wajib diaudit akuntan publik (Permenkop UKM No. 2/2024 Pasal 12)`,
          permissionModule: "config",
          permissionAction: "read"
        });
        return true;
      });
      if (notified) result.notified += 1;
    } catch (err) {
      console.error(`Audit threshold check failed for tenant ${tenant.id}`, err);
      result.failed += 1;
    }
  }
  return result;
}
