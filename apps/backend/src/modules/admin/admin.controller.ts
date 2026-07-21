import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { adminService } from './admin.service';
import { AppError } from '../../lib/errors';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const UpdateTenantSchema = z.object({
  isActive: z.boolean().optional(),
  packageId: z.string().nullable().optional(),
  nextBillingDate: z.coerce.date().nullable().optional(),
});

const CreatePlatformAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
});

const UpdatePlatformAdminSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
});

const CreatePackageSchema = z.object({
  name: z.string().min(2),
  price: z.coerce.number().min(0),
  modules: z.array(z.string()),
  maxUsers: z.coerce.number().int().min(1),
  maxMembers: z.coerce.number().int().min(1),
  maxSavingConfigs: z.coerce.number().int().min(0).nullable().optional(),
  whitelabelEnabled: z.boolean().optional(),
});

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getDashboard();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function listTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = PaginationSchema.parse(req.query);
    const result = await adminService.listTenants(page, limit);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function getTenantDetail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.getTenantDetail(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateTenantSchema.parse(req.body);
    const tenant = await adminService.updateTenant(req.params.id, data);
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function uploadTenantLogo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) throw new AppError('NO_FILE', 'File logo wajib diunggah', 400);
    const tenant = await adminService.updateTenantLogo(req.params.id, req.file.path);
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function getTenantStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.getTenantStats(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page, limit, unreadOnly } = NotificationQuerySchema.parse(req.query);
    const result = await adminService.listNotifications(req.user.id, page, limit, unreadOnly);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadNotificationCount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const count = await adminService.getUnreadNotificationCount(req.user.id);
    res.json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
}

export async function markNotificationRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await adminService.markNotificationRead(req.user.id, req.params.id);
    res.json({ success: true, data: { message: 'Notifikasi ditandai sudah dibaca' } });
  } catch (err) {
    next(err);
  }
}

export async function markAllNotificationsRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await adminService.markAllNotificationsRead(req.user.id);
    res.json({ success: true, data: { message: 'Semua notifikasi ditandai sudah dibaca' } });
  } catch (err) {
    next(err);
  }
}

export async function listPlatformAdmins(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await adminService.listPlatformAdmins();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createPlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = CreatePlatformAdminSchema.parse(req.body);
    const admin = await adminService.createPlatformAdmin(
      { tenantId: req.user.tenantId, roleId: req.user.roleId },
      data
    );
    res.status(201).json({ success: true, data: admin });
  } catch (err) {
    next(err);
  }
}

export async function updatePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = UpdatePlatformAdminSchema.parse(req.body);
    const admin = await adminService.updatePlatformAdmin(req.params.id, data);
    res.json({ success: true, data: admin });
  } catch (err) {
    next(err);
  }
}

export async function deactivatePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await adminService.deactivatePlatformAdmin(req.params.id, req.user.id);
    res.json({ success: true, data: { message: 'Platform admin berhasil dinonaktifkan' } });
  } catch (err) {
    next(err);
  }
}

export async function listPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.listPackages();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createPackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = CreatePackageSchema.parse(req.body);
    const pkg = await adminService.createPackage(data);
    res.status(201).json({ success: true, data: pkg });
  } catch (err) {
    next(err);
  }
}

export async function updatePackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = CreatePackageSchema.partial().parse(req.body);
    const pkg = await adminService.updatePackage(req.params.id, data);
    res.json({ success: true, data: pkg });
  } catch (err) {
    next(err);
  }
}

export async function deactivatePackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pkg = await adminService.deactivatePackage(req.params.id);
    res.json({ success: true, data: pkg });
  } catch (err) {
    next(err);
  }
}
