import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { adminService } from './admin.service';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const UpdateTenantSchema = z.object({
  isActive: z.boolean().optional(),
  packageId: z.string().nullable().optional(),
  nextBillingDate: z.coerce.date().nullable().optional(),
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
