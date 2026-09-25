import type { Prisma } from "@prisma/client";
import type { AuditThresholdCheckResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { MODAL_DISETOR_AUDIT_THRESHOLD_RP } from "../../lib/regulatory-config.js";
import { createTenantNotification } from "../notifications/service.js";
import { getModalSendiri } from "../reports/capital-service.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 1 January 00:00 WIB of `asOf`'s calendar year in Indonesia, as a UTC instant. */
function startOfWibYear(asOf: Date): Date {
  const wibYear = new Date(asOf.getTime() + WIB_OFFSET_MS).getUTCFullYear();
  return new Date(Date.UTC(wibYear, 0, 1) - WIB_OFFSET_MS);
}

function wibYearOf(instant: Date): number {
  return new Date(instant.getTime() + WIB_OFFSET_MS).getUTCFullYear();
}

/** "5000000000.5" → "Rp5.000.000.000,50" — string-based, so no float rounding. */
function rupiah(value: Prisma.Decimal): string {
  const [whole = "0", fraction = "00"] = value.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp${grouped}${fraction === "00" ? "" : `,${fraction}`}`;
}

type StampField = "auditThresholdNotifiedAt" | "auditApproachingNotifiedAt";

/**
 * Daily Permenkop UKM No. 2/2024 Pasal 12 reminder, judged on Modal Sendiri
 * from the ledger (modules/reports/capital-service.ts), not a hand-typed
 * figure. Pasal 12(1) is about the modal of a tahun buku, so:
 *
 * - AUDIT_THRESHOLD_EXCEEDED — Modal Sendiri as of the previous 31 December
 *   (WIB) reached Rp5 miliar: that tahun buku's report must be audited.
 * - AUDIT_THRESHOLD_APPROACHING — otherwise, the running year's figure already
 *   reached it: an early warning that this tahun buku will be.
 *
 * Only tenants with an active KSP unit — Pasal 12(2) leaves sektor riil
 * criteria to the Deputi. Each kind notifies at most once per calendar year
 * (WIB); the stamp is claimed with a conditional updateMany inside the same
 * transaction as the notification, so overlapping runs or Cloud Scheduler
 * retries never notify twice. A reminder only — nothing is blocked.
 * `tenantId` narrows the sweep to one tenant (tests).
 */
export async function checkAuditThreshold(asOf: Date = new Date(), tenantId?: string): Promise<AuditThresholdCheckResult> {
  const yearStart = startOfWibYear(asOf);
  const previousYearEnd = new Date(yearStart.getTime() - 1);
  const closedYear = wibYearOf(previousYearEnd);
  const runningYear = wibYearOf(asOf);

  const tenants = await db.tenant.findMany({
    where: {
      units: { some: { type: "KSP", isActive: true } },
      ...(tenantId ? { id: tenantId } : {})
    },
    select: { id: true, name: true }
  });

  const result: AuditThresholdCheckResult = { checked: tenants.length, notified: 0, failed: 0 };
  for (const tenant of tenants) {
    try {
      const closed = await getModalSendiri(tenant.id, previousYearEnd);
      let notified = false;
      if (closed.total.gte(MODAL_DISETOR_AUDIT_THRESHOLD_RP)) {
        notified = await notifyOncePerYear(tenant.id, "auditThresholdNotifiedAt", asOf, yearStart, {
          type: "AUDIT_THRESHOLD_EXCEEDED",
          title: "Ambang audit wajib tercapai",
          message:
            `Modal sendiri ${tenant.name} per 31 Desember ${closedYear} sebesar ${rupiah(closed.total)} telah mencapai ambang ` +
            `${rupiah(MODAL_DISETOR_AUDIT_THRESHOLD_RP)} — laporan keuangan tahun buku ${closedYear} wajib diaudit akuntan publik ` +
            `(Permenkop UKM No. 2/2024 Pasal 12)`
        });
      } else {
        const running = await getModalSendiri(tenant.id, asOf);
        if (running.total.gte(MODAL_DISETOR_AUDIT_THRESHOLD_RP)) {
          notified = await notifyOncePerYear(tenant.id, "auditApproachingNotifiedAt", asOf, yearStart, {
            type: "AUDIT_THRESHOLD_APPROACHING",
            title: "Modal sendiri mencapai ambang audit",
            message:
              `Modal sendiri ${tenant.name} saat ini sebesar ${rupiah(running.total)} telah mencapai ambang ` +
              `${rupiah(MODAL_DISETOR_AUDIT_THRESHOLD_RP)} — jika bertahan hingga akhir tahun, laporan keuangan tahun buku ` +
              `${runningYear} wajib diaudit akuntan publik (Permenkop UKM No. 2/2024 Pasal 12). Siapkan penunjukan KAP terdaftar.`
          });
        }
      }
      if (notified) result.notified += 1;
    } catch (err) {
      console.error(`Audit threshold check failed for tenant ${tenant.id}`, err);
      result.failed += 1;
    }
  }
  return result;
}

async function notifyOncePerYear(
  tenantId: string,
  stamp: StampField,
  asOf: Date,
  yearStart: Date,
  notification: { type: string; title: string; message: string }
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.tenant.updateMany({
      where: { id: tenantId, OR: [{ [stamp]: null }, { [stamp]: { lt: yearStart } }] },
      data: { [stamp]: asOf }
    });
    if (claimed.count === 0) return false;

    await createTenantNotification(tx, {
      tenantId,
      ...notification,
      permissionModule: "config",
      permissionAction: "read"
    });
    return true;
  });
}
