import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import prisma from '../lib/prisma';

export async function adminMiddleware(
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

    if (!user.isPlatformAdmin) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Akses hanya untuk platform administrator' },
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
