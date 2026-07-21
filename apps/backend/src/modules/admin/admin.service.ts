import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { createNotification } from '../../lib/notifications';

export class AdminService {
  async getDashboard() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalTenants, activeTenants, totalMembers, totalTransactions30d] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.member.count({ where: { isActive: true } }),
      prisma.loanPayment.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    return { totalTenants, activeTenants, totalMembers, totalTransactions30d };
  }

  async listTenants(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.tenant.findMany({
        skip,
        take: limit,
        include: { package: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.count(),
    ]);
    return { items, meta: { page, limit, total } };
  }

  async getTenantDetail(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { package: true },
    });
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);
    return tenant;
  }

  async updateTenant(
    tenantId: string,
    data: { isActive?: boolean; packageId?: string | null; nextBillingDate?: Date | null }
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);

    const updateData: typeof data & {
      billingReminder30SentAt?: null;
      billingReminder7SentAt?: null;
    } = { ...data };

    // Renewing the billing date starts a fresh reminder cycle and lifts an auto-block
    // (unless the caller is explicitly also setting isActive in this same request).
    if ('nextBillingDate' in data) {
      updateData.billingReminder30SentAt = null;
      updateData.billingReminder7SentAt = null;
      if (data.isActive === undefined && data.nextBillingDate && data.nextBillingDate > new Date()) {
        updateData.isActive = true;
      }
    }

    const updated = await prisma.tenant.update({ where: { id: tenantId }, data: updateData });

    if ('packageId' in data && data.packageId !== tenant.packageId) {
      await createNotification({
        type: 'PACKAGE_CHANGED',
        title: 'Paket langganan diubah',
        message: `Paket langganan ${tenant.name} diperbarui`,
        relatedTenantId: tenantId,
      });
    }

    return updated;
  }

  async updateTenantLogo(tenantId: string, logoUrl: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);
    return prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl } });
  }

  async getTenantStats(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);

    const [memberCount, savingCount, loanCount, activeLoans] = await Promise.all([
      prisma.member.count({ where: { tenantId, isActive: true } }),
      prisma.saving.count({ where: { tenantId, isActive: true } }),
      prisma.loan.count({ where: { tenantId } }),
      prisma.loan.count({ where: { tenantId, status: 'ACTIVE' } }),
    ]);

    return { tenantId, memberCount, savingCount, loanCount, activeLoans };
  }

  // ── Subscription Packages ────────────────────────────────────────────────────

  async listPackages() {
    return prisma.subscriptionPackage.findMany({ where: { isActive: true } });
  }

  async createPackage(data: {
    name: string;
    price: number;
    modules: string[];
    maxUsers: number;
    maxMembers: number;
    maxSavingConfigs?: number | null;
    whitelabelEnabled?: boolean;
  }) {
    return prisma.subscriptionPackage.create({ data: { ...data, isActive: true } });
  }

  async updatePackage(
    id: string,
    data: Partial<{
      name: string;
      price: number;
      modules: string[];
      maxUsers: number;
      maxMembers: number;
      maxSavingConfigs: number | null;
      whitelabelEnabled: boolean;
      isActive: boolean;
    }>
  ) {
    const pkg = await prisma.subscriptionPackage.findUnique({ where: { id } });
    if (!pkg) throw new AppError('PACKAGE_NOT_FOUND', 'Paket tidak ditemukan', 404);
    return prisma.subscriptionPackage.update({ where: { id }, data });
  }

  async deactivatePackage(id: string) {
    const pkg = await prisma.subscriptionPackage.findUnique({ where: { id } });
    if (!pkg) throw new AppError('PACKAGE_NOT_FOUND', 'Paket tidak ditemukan', 404);
    return prisma.subscriptionPackage.update({ where: { id }, data: { isActive: false } });
  }

  // ── Notifications (in-app, platform admin) ────────────────────────────────────

  async listNotifications(userId: string, page: number, limit: number, unreadOnly?: boolean) {
    const skip = (page - 1) * limit;
    const where = unreadOnly ? { reads: { none: { userId } } } : {};

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        include: {
          relatedTenant: { select: { id: true, name: true, slug: true } },
          reads: { where: { userId }, select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      items: items.map(({ reads, ...n }) => ({ ...n, isRead: reads.length > 0 })),
      meta: { page, limit, total },
    };
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { reads: { none: { userId } } } });
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notif) throw new AppError('NOTIFICATION_NOT_FOUND', 'Notifikasi tidak ditemukan', 404);

    await prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    const unread = await prisma.notification.findMany({
      where: { reads: { none: { userId } } },
      select: { id: true },
    });
    if (unread.length === 0) return;

    await prisma.notificationRead.createMany({
      data: unread.map((n) => ({ notificationId: n.id, userId })),
      skipDuplicates: true,
    });
  }

  // ── Platform Admin Users ──────────────────────────────────────────────────────
  //
  // Platform admins are User rows with isPlatformAdmin=true. The User model
  // requires a tenantId + roleId (tenant-scoped RBAC), which is meaningless for
  // platform admins since adminMiddleware only checks isPlatformAdmin — it never
  // consults role.permissions. New platform admins are attached to the creating
  // admin's own tenantId/roleId purely to satisfy that FK constraint.

  async listPlatformAdmins() {
    return prisma.user.findMany({
      where: { isPlatformAdmin: true },
      omit: { passwordHash: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPlatformAdmin(
    creator: { tenantId: string; roleId: string },
    data: { name: string; email: string; password: string }
  ) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, isPlatformAdmin: true },
    });
    if (existing) {
      throw new AppError('EMAIL_EXISTS', 'Email sudah terdaftar sebagai platform admin', 409);
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    return prisma.user.create({
      data: {
        tenantId: creator.tenantId,
        roleId: creator.roleId,
        email: data.email,
        passwordHash,
        name: data.name,
        isPlatformAdmin: true,
        isActive: true,
      },
      omit: { passwordHash: true },
    });
  }

  async updatePlatformAdmin(id: string, data: { name?: string; email?: string; isActive?: boolean }) {
    const user = await prisma.user.findFirst({ where: { id, isPlatformAdmin: true } });
    if (!user) throw new AppError('USER_NOT_FOUND', 'Platform admin tidak ditemukan', 404);

    if (data.email && data.email !== user.email) {
      const dup = await prisma.user.findFirst({
        where: { email: data.email, isPlatformAdmin: true },
      });
      if (dup) throw new AppError('EMAIL_EXISTS', 'Email sudah digunakan', 409);
    }

    return prisma.user.update({
      where: { id },
      data,
      omit: { passwordHash: true },
    });
  }

  async deactivatePlatformAdmin(id: string, requestingUserId: string): Promise<void> {
    const user = await prisma.user.findFirst({ where: { id, isPlatformAdmin: true } });
    if (!user) throw new AppError('USER_NOT_FOUND', 'Platform admin tidak ditemukan', 404);

    if (id === requestingUserId) {
      throw new AppError('CANNOT_DEACTIVATE_SELF', 'Anda tidak dapat menonaktifkan akun sendiri', 400);
    }

    await prisma.user.update({ where: { id }, data: { isActive: false } });
  }
}

export const adminService = new AdminService();
