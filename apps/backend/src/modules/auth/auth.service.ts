import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { addMonths } from 'date-fns';
import { Tenant, User, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { AppError } from '../../lib/errors';
import { createNotification } from '../../lib/notifications';
import { RegisterTenantInput } from './auth.schema';

export type UserWithRole = User & { role: Role };

interface GoogleProfile {
  id: string;
  email: string;
  name: string;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const defaultPermissions = {
  dashboard: { read: true },
  members: { create: true, read: true, update: true, delete: true },
  savings: { create: true, read: true, update: true, delete: true },
  loans: { create: true, read: true, update: true, delete: true },
  reports: { read: true, export: true },
  config: { read: true, update: true },
  users: { create: true, read: true, update: true, delete: true },
  roles: { create: true, read: true, update: true, delete: true },
};

export class AuthService {
  async registerTenant(
    data: RegisterTenantInput
  ): Promise<{ tenant: Tenant; loginUrl: string }> {
    const existing = await prisma.tenant.findUnique({
      where: { registrationNo: data.registrationNo },
    });
    if (existing) {
      throw new AppError(
        'REGISTRATION_NO_EXISTS',
        'Nomor pendaftaran sudah terdaftar',
        409
      );
    }

    let slug = generateSlug(data.name);
    const slugExists = await prisma.tenant.findUnique({ where: { slug } });
    if (slugExists) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    const passwordHash = await bcrypt.hash(data.adminPassword, 12);

    const tenant = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug,
          address: data.address,
          registrationNo: data.registrationNo,
          type: data.type as unknown as import('@prisma/client').TenantType,
          cooperativeType: data.cooperativeType,
          isActive: true,
          nextBillingDate: addMonths(new Date(), 1),
        },
      });

      const superAdminRole = await tx.role.create({
        data: {
          tenantId: newTenant.id,
          name: 'Super Admin',
          permissions: defaultPermissions,
        },
      });

      await tx.role.createMany({
        data: [
          {
            tenantId: newTenant.id,
            name: 'Manager',
            permissions: {
              ...defaultPermissions,
              config: { read: true, update: false },
              users: { create: false, read: true, update: false, delete: false },
              roles: { create: false, read: true, update: false, delete: false },
            },
          },
          {
            tenantId: newTenant.id,
            name: 'Teller',
            permissions: {
              dashboard: { read: true },
              members: { create: false, read: true, update: false, delete: false },
              savings: { create: true, read: true, update: true, delete: false },
              loans: { create: false, read: true, update: true, delete: false },
              reports: { read: false, export: false },
              config: { read: false, update: false },
              users: { create: false, read: false, update: false, delete: false },
              roles: { create: false, read: false, update: false, delete: false },
            },
          },
          {
            tenantId: newTenant.id,
            name: 'Viewer',
            permissions: {
              dashboard: { read: true },
              members: { create: false, read: true, update: false, delete: false },
              savings: { create: false, read: true, update: false, delete: false },
              loans: { create: false, read: true, update: false, delete: false },
              reports: { read: true, export: false },
              config: { read: false, update: false },
              users: { create: false, read: false, update: false, delete: false },
              roles: { create: false, read: false, update: false, delete: false },
            },
          },
        ],
      });

      await tx.user.create({
        data: {
          tenantId: newTenant.id,
          roleId: superAdminRole.id,
          email: data.adminEmail,
          passwordHash,
          name: data.adminName,
          isActive: true,
        },
      });

      // Every tenant gets these 3 default Simpanan configs regardless of package (Design Spec §4)
      const defaultSavingTypes: import('@prisma/client').SavingType[] = ['POKOK', 'WAJIB', 'SUKARELA'];
      const defaultSavingNames: Record<string, string> = {
        POKOK: 'Simpanan Pokok',
        WAJIB: 'Simpanan Wajib',
        SUKARELA: 'Simpanan Sukarela',
      };
      await tx.savingConfig.createMany({
        data: defaultSavingTypes.map((type) => ({
          tenantId: newTenant.id,
          name: defaultSavingNames[type],
          type,
          rateType: 'BUNGA' as const,
          rate: 0,
          periodUnit: 'MONTHLY',
          isDefault: true,
          isActive: true,
        })),
      });

      await createNotification(
        {
          type: 'TENANT_REGISTERED',
          title: 'Koperasi baru terdaftar',
          message: `${newTenant.name} baru saja mendaftar ke platform`,
          relatedTenantId: newTenant.id,
        },
        tx
      );

      return newTenant;
    });

    const domain = process.env.PLATFORM_DOMAIN || 'siskop.com';
    return { tenant, loginUrl: `https://${slug}.${domain}/login` };
  }

  async login(
    tenantId: string,
    email: string,
    password: string
  ): Promise<{ user: UserWithRole; tenant: Tenant; accessToken: string; refreshToken: string }> {
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('UNAUTHORIZED', 'Email atau password salah', 401);
    }

    if (!user.passwordHash) {
      throw new AppError(
        'SSO_ONLY_ACCOUNT',
        'Akun ini hanya bisa login via Google SSO',
        400
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError('UNAUTHORIZED', 'Email atau password salah', 401);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { package: true },
    });
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      email: user.email,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const tokenHash = hashToken(refreshToken);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { user, tenant, accessToken, refreshToken };
  }

  async refreshToken(
    token: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const decoded = verifyRefreshToken(token);
    // Strip JWT-added fields (exp, iat, jti) so re-signing with expiresIn doesn't conflict
    const payload = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      roleId: decoded.roleId,
      email: decoded.email,
    };
    const tokenHash = hashToken(token);

    const record = await prisma.refreshToken.findUnique({ where: { token: tokenHash } });
    if (!record) {
      throw new AppError('UNAUTHORIZED', 'Refresh token tidak valid', 401);
    }
    if (record.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { token: tokenHash } });
      throw new AppError('UNAUTHORIZED', 'Refresh token sudah kadaluarsa', 401);
    }

    await prisma.refreshToken.delete({ where: { token: tokenHash } });

    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);
    const newHash = hashToken(newRefreshToken);

    await prisma.refreshToken.create({
      data: {
        userId: record.userId,
        token: newHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.deleteMany({
      where: { userId, token: tokenHash },
    });
  }

  async findOrCreateGoogleUser(
    tenantId: string,
    googleProfile: GoogleProfile
  ): Promise<UserWithRole> {
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: googleProfile.email } },
      include: { role: true },
    });

    if (!user) {
      throw new AppError(
        'GOOGLE_USER_NOT_FOUND',
        'Email Google tidak terdaftar. Hubungi administrator koperasi.',
        403
      );
    }

    if (!user.isActive) {
      throw new AppError('FORBIDDEN', 'Akun tidak aktif', 403);
    }

    return user;
  }
}

export const authService = new AuthService();
