import { Request, Response, NextFunction } from 'express';
import { RegisterTenantSchema, LoginSchema } from './auth.schema';
import { authService } from './auth.service';
import { AppError } from '../../lib/errors';

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function setCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearCookies(res: Response) {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = RegisterTenantSchema.parse(req.body);
    const result = await authService.registerTenant(data);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    if (!req.tenant) {
      throw new AppError('TENANT_NOT_FOUND', 'Koperasi tidak ditemukan', 404);
    }

    const result = await authService.login(req.tenant.id, email, password);
    setCookies(res, result.accessToken, result.refreshToken);

    res.json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
        },
        tenant: result.tenant,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) throw new AppError('UNAUTHORIZED', 'Refresh token tidak ditemukan', 401);

    const result = await authService.refreshToken(token);
    setCookies(res, result.accessToken, result.refreshToken);
    res.json({ success: true, data: { message: 'Token diperbarui' } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.refresh_token;
    if (token && req.user) {
      await authService.logout(req.user.id, token);
    }
    clearCookies(res);
    res.json({ success: true, data: { message: 'Logout berhasil' } });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { passwordHash: _, ...userSafe } = req.user as typeof req.user & { passwordHash?: string };
    res.json({ success: true, data: { user: userSafe, tenant: req.tenant } });
  } catch (err) {
    next(err);
  }
}

export async function googleCallback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user as typeof req.user & {
      accessToken?: string;
      refreshToken?: string;
    };

    if (!user?.accessToken || !user?.refreshToken) {
      throw new AppError('UNAUTHORIZED', 'Google SSO gagal', 401);
    }

    setCookies(res, user.accessToken, user.refreshToken);
    const domain = process.env.PLATFORM_DOMAIN || 'localhost';
    res.redirect(`https://${req.tenant?.slug}.${domain}/dashboard`);
  } catch (err) {
    next(err);
  }
}
