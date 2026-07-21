import { Tenant } from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { formatTanggalIndonesia } from '@siskop/shared';
import prisma from './prisma';
import { sendMail } from './mailer';
import { createNotification } from './notifications';

type NoticeKind = 'REMINDER_30' | 'REMINDER_7' | 'BLOCKED';

async function getTenantAdminEmail(tenantId: string): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  return admin?.email ?? null;
}

async function notifyTenant(tenant: Tenant, kind: NoticeKind): Promise<void> {
  const email = await getTenantAdminEmail(tenant.id);
  if (!email || !tenant.nextBillingDate) return;

  const dateStr = formatTanggalIndonesia(tenant.nextBillingDate);
  const subject =
    kind === 'BLOCKED'
      ? `[SISKOP] Akses ${tenant.name} dinonaktifkan — tagihan jatuh tempo`
      : `[SISKOP] Pengingat tagihan berlangganan — ${tenant.name}`;

  const html =
    kind === 'BLOCKED'
      ? `<p>Akses koperasi <strong>${tenant.name}</strong> telah dinonaktifkan karena tagihan berlangganan jatuh tempo pada <strong>${dateStr}</strong> belum diperbarui.</p>
         <p>Silakan hubungi platform administrator untuk memperbarui tanggal tagihan dan mengaktifkan kembali akses.</p>`
      : `<p>Tagihan berlangganan koperasi <strong>${tenant.name}</strong> akan jatuh tempo pada <strong>${dateStr}</strong>.</p>
         <p>Mohon segera lakukan pembayaran untuk menghindari pemblokiran akses otomatis.</p>`;

  await sendMail({ to: email, subject, html });
}

// Runs daily: sends renewal reminders at 30/7 days before nextBillingDate,
// and auto-blocks tenant access (isActive=false) once the date has passed.
export async function processBillingReminders(tenantId?: string): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      nextBillingDate: { not: null },
      ...(tenantId ? { id: tenantId } : {}),
    },
  });

  const today = new Date();

  for (const tenant of tenants) {
    if (!tenant.nextBillingDate) continue;
    const daysUntilDue = differenceInCalendarDays(tenant.nextBillingDate, today);

    if (daysUntilDue < 0) {
      if (tenant.isActive) {
        await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
        await notifyTenant(tenant, 'BLOCKED');
        await createNotification({
          type: 'BILLING_BLOCKED',
          title: 'Akses koperasi diblokir',
          message: `${tenant.name} diblokir otomatis karena tagihan langganan telah jatuh tempo`,
          relatedTenantId: tenant.id,
        });
      }
      continue;
    }

    if (daysUntilDue === 30 && !tenant.billingReminder30SentAt) {
      await notifyTenant(tenant, 'REMINDER_30');
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { billingReminder30SentAt: today },
      });
    }

    if (daysUntilDue === 7 && !tenant.billingReminder7SentAt) {
      await notifyTenant(tenant, 'REMINDER_7');
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { billingReminder7SentAt: today },
      });
    }
  }
}
