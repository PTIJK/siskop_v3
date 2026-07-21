import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { configService } from './config.service';
import { AppError } from '../../lib/errors';

const UpdateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .optional(),
});

const CreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  roleId: z.string().cuid(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  roleId: z.string().cuid().optional(),
  isActive: z.boolean().optional(),
});

const RoleSchema = z.object({
  name: z.string().min(2),
  permissions: z.record(z.unknown()),
});

const WhitelabelSchema = z.object({
  customDomain: z.string().min(3).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Format warna harus hex, contoh: #1a2b3c')
    .nullable()
    .optional(),
  hideBranding: z.boolean().optional(),
  emailSenderName: z.string().min(2).nullable().optional(),
  emailSenderAddress: z.string().email().nullable().optional(),
});

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await configService.getProfile(req.tenant.id, req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = UpdateProfileSchema.parse(req.body);
    const user = await configService.updateProfile(req.tenant.id, req.user.id, data);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new AppError('NO_FILE', 'File logo wajib diunggah', 400);
    const tenant = await configService.updateTenantLogo(req.tenant.id, req.file.path);
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await configService.listUsers(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateUserSchema.parse(req.body);
    const user = await configService.createUser(req.tenant.id, data);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateUserSchema.parse(req.body);
    const user = await configService.updateUser(req.tenant.id, req.params.id, data);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await configService.deactivateUser(req.tenant.id, req.params.id);
    res.json({ success: true, data: { message: 'User berhasil dinonaktifkan' } });
  } catch (err) {
    next(err);
  }
}

export async function listRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await configService.listRoles(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = RoleSchema.parse(req.body);
    const role = await configService.createRole(req.tenant.id, data);
    res.status(201).json({ success: true, data: role });
  } catch (err) {
    next(err);
  }
}

export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = RoleSchema.partial().parse(req.body);
    const role = await configService.updateRole(req.tenant.id, req.params.id, data);
    res.json({ success: true, data: role });
  } catch (err) {
    next(err);
  }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await configService.deleteRole(req.tenant.id, req.params.id);
    res.json({ success: true, data: { message: 'Role berhasil dihapus' } });
  } catch (err) {
    next(err);
  }
}

export async function getWhitelabel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await configService.getWhitelabelConfig(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function upsertWhitelabel(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = WhitelabelSchema.parse(req.body);
    const config = await configService.upsertWhitelabelConfig(req.tenant.id, data);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}
