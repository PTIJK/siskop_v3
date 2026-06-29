import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { Tenant } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      tenant: Tenant;
    }
  }
}

const SKIP_SUBDOMAINS = ['admin', 'www', 'api'];

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const host = req.hostname;
    const slug = host.split('.')[0];

    if (!slug || SKIP_SUBDOMAINS.includes(slug)) {
      next();
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug, isActive: true },
    });

    if (!tenant) {
      res.status(404).json({
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Koperasi tidak ditemukan atau tidak aktif',
        },
      });
      return;
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    next(error);
  }
}
