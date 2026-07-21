import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

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

    return prisma.tenant.update({ where: { id: tenantId }, data: updateData });
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
}

export const adminService = new AdminService();
