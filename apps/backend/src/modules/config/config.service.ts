import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

export class ConfigService {
  // ── Profile ──────────────────────────────────────────────────────────────────

  async getProfile(tenantId: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { role: true },
      omit: { passwordHash: true },
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
    return user;
  }

  async updateProfile(
    tenantId: string,
    userId: string,
    data: { name?: string; email?: string; password?: string }
  ) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);

    if (data.email && data.email !== user.email) {
      const dup = await prisma.user.findFirst({
        where: { tenantId, email: data.email },
      });
      if (dup) throw new AppError('EMAIL_EXISTS', 'Email sudah digunakan', 409);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 12);

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      omit: { passwordHash: true },
    });
  }

  async updateTenantLogo(tenantId: string, logoUrl: string) {
    return prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl } });
  }

  // ── Users ─────────────────────────────────────────────────────────────────────

  async listUsers(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      include: { role: { select: { id: true, name: true } } },
      omit: { passwordHash: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(
    tenantId: string,
    data: { name: string; email: string; password: string; roleId: string }
  ) {
    const dupEmail = await prisma.user.findFirst({ where: { tenantId, email: data.email } });
    if (dupEmail) throw new AppError('EMAIL_EXISTS', 'Email sudah terdaftar', 409);

    const role = await prisma.role.findFirst({ where: { id: data.roleId, tenantId } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);

    const passwordHash = await bcrypt.hash(data.password, 12);
    return prisma.user.create({
      data: { tenantId, roleId: data.roleId, email: data.email, passwordHash, name: data.name, isActive: true },
      omit: { passwordHash: true },
    });
  }

  async updateUser(
    tenantId: string,
    userId: string,
    data: { name?: string; email?: string; roleId?: string; isActive?: boolean }
  ) {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);

    if (data.email && data.email !== user.email) {
      const dup = await prisma.user.findFirst({ where: { tenantId, email: data.email } });
      if (dup) throw new AppError('EMAIL_EXISTS', 'Email sudah digunakan', 409);
    }

    if (data.roleId) {
      const role = await prisma.role.findFirst({ where: { id: data.roleId, tenantId } });
      if (!role) throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);
    }

    return prisma.user.update({
      where: { id: userId },
      data,
      omit: { passwordHash: true },
    });
  }

  async deactivateUser(tenantId: string, userId: string): Promise<void> {
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  }

  // ── Roles ─────────────────────────────────────────────────────────────────────

  async listRoles(tenantId: string) {
    return prisma.role.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async createRole(tenantId: string, data: { name: string; permissions: unknown }) {
    return prisma.role.create({ data: { tenantId, name: data.name, permissions: data.permissions as import('@prisma/client').Prisma.InputJsonValue } });
  }

  async updateRole(
    tenantId: string,
    roleId: string,
    data: { name?: string; permissions?: unknown }
  ) {
    const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);
    return prisma.role.update({
      where: { id: roleId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.permissions ? { permissions: data.permissions as import('@prisma/client').Prisma.InputJsonValue } : {}),
      },
    });
  }

  // ── Whitelabel ───────────────────────────────────────────────────────────────

  async getWhitelabelConfig(tenantId: string) {
    return prisma.whitelabelConfig.findUnique({ where: { tenantId } });
  }

  async upsertWhitelabelConfig(
    tenantId: string,
    data: {
      customDomain?: string | null;
      primaryColor?: string | null;
      hideBranding?: boolean;
      emailSenderName?: string | null;
      emailSenderAddress?: string | null;
    }
  ) {
    if (data.customDomain) {
      const dup = await prisma.whitelabelConfig.findFirst({
        where: { customDomain: data.customDomain, tenantId: { not: tenantId } },
      });
      if (dup) throw new AppError('DOMAIN_ALREADY_USED', 'Domain kustom sudah digunakan koperasi lain', 409);
    }

    const existing = await prisma.whitelabelConfig.findUnique({ where: { tenantId } });

    // Changing the custom domain resets verification — it must be re-verified via DNS.
    const domainChanged = existing && 'customDomain' in data && data.customDomain !== existing.customDomain;

    return prisma.whitelabelConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: {
        ...data,
        ...(domainChanged || (!existing && data.customDomain) ? { domainStatus: 'PENDING' } : {}),
      },
    });
  }
}

export const configService = new ConfigService();
