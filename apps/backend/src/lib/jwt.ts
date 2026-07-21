import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const ACCESS_SECRET = process.env.JWT_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export interface JwtPayload {
  userId: string;
  tenantId: string;
  roleId: string;
  email: string;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(8).toString('hex') } as unknown as Record<string, unknown>,
    ACCESS_SECRET,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'] }
  );
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString('hex') } as unknown as Record<string, unknown>,
    REFRESH_SECRET,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Token tidak valid atau sudah kadaluarsa', 401);
  }
}

export function verifyRefreshToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Refresh token tidak valid atau sudah kadaluarsa', 401);
  }
}
