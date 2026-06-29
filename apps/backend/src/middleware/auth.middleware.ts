import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../lib/jwt';
import prisma from '../lib/prisma';
import { User, Role } from '@prisma/client';

type UserWithRole = User & { role: Role };

declare global {
  namespace Express {
    interface Request {
      user: UserWithRole;
      jwtPayload: JwtPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.access_token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Tidak terautentikasi' },
      });
      return;
    }

    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Akun tidak ditemukan atau nonaktif' },
      });
      return;
    }

    if (req.tenant && user.tenantId !== req.tenant.id) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Akses ditolak' },
      });
      return;
    }

    req.user = user;
    req.jwtPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
}
