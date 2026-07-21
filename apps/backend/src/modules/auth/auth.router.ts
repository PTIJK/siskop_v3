import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { register, login, refresh, logout, me } from './auth.controller';

export const authRouter = Router();

authRouter.post('/register-tenant', register);
authRouter.post('/login', tenantMiddleware, login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', authMiddleware, logout);
authRouter.get('/me', tenantMiddleware, authMiddleware, me);

// Google OAuth — stubs (requires passport setup with valid credentials)
authRouter.get('/google', tenantMiddleware, (_req, res) => {
  res.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Google SSO belum dikonfigurasi' } });
});
authRouter.get('/google/callback', tenantMiddleware, (_req, res) => {
  res.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Google SSO belum dikonfigurasi' } });
});
