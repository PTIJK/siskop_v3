import { formatRupiah } from '@siskop/shared';
import prisma from './prisma';
import { createNotification } from './notifications';

// Permenkop UKM No. 2/2024 Pasal 12 — koperasi dengan modal disetor >= Rp5 miliar
// wajib diaudit akuntan publik terdaftar Kemenkop. Threshold belum diverifikasi
// ke teks regulasi primer secara independen dari riset panel (lihat Design Spec
// §11) — notifikasi ini sengaja hanya pengingat kepatuhan in-app, bukan enforcement.
const AUDIT_THRESHOLD = 5_000_000_000;

// Runs daily: notifies platform admins once per calendar year when a tenant's
// modalDisetor crosses the mandatory-audit threshold. `tenantId` narrows to one
// tenant for tests; omitted in production (called from the scheduler for all tenants).
export async function checkAuditThreshold(tenantId?: string): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      modalDisetor: { gte: AUDIT_THRESHOLD },
      ...(tenantId ? { id: tenantId } : {}),
    },
  });

  const currentYear = new Date().getFullYear();

  for (const tenant of tenants) {
    const alreadyNotifiedThisYear =
      tenant.auditThresholdNotifiedAt !== null &&
      tenant.auditThresholdNotifiedAt.getFullYear() === currentYear;
    if (alreadyNotifiedThisYear) continue;

    await createNotification({
      type: 'AUDIT_THRESHOLD_EXCEEDED',
      title: 'Ambang audit wajib terlampaui',
      message: `${tenant.name} memiliki modal disetor ${formatRupiah(tenant.modalDisetor!.toString())} — melebihi ambang Rp5 miliar (Permenkop UKM No. 2/2024 Pasal 12), wajib diaudit akuntan publik terdaftar Kemenkop`,
      relatedTenantId: tenant.id,
    });

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { auditThresholdNotifiedAt: new Date() },
    });
  }
}
