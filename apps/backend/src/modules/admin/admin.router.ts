import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { AppError } from '../../lib/errors';
import {
  getDashboard,
  listTenants,
  getTenantDetail,
  updateTenant,
  getTenantStats,
  uploadTenantLogo,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  listPlatformAdmins,
  createPlatformAdmin,
  updatePlatformAdmin,
  deactivatePlatformAdmin,
  listPackages,
  createPackage,
  updatePackage,
  deactivatePackage,
} from './admin.controller';

export const adminRouter = Router();

// Logo upload — stores under the same uploads/logos/{tenantId} path tenant
// self-service uploads use (see config.router.ts), so either side can set it.
const logoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(process.env.STORAGE_PATH || './uploads', 'logos', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/svg+xml'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('INVALID_FILE_TYPE', 'File harus JPG, PNG, atau SVG', 400));
    }
  },
});

// Dashboard
adminRouter.get('/dashboard', getDashboard);

// Tenant management
adminRouter.get('/tenants', listTenants);
adminRouter.get('/tenants/:id', getTenantDetail);
adminRouter.put('/tenants/:id', updateTenant);
adminRouter.get('/tenants/:id/stats', getTenantStats);
adminRouter.post('/tenants/:id/logo', logoUpload.single('logo'), uploadTenantLogo);

// Notifications
adminRouter.get('/notifications', listNotifications);
adminRouter.get('/notifications/unread-count', getUnreadNotificationCount);
adminRouter.post('/notifications/read-all', markAllNotificationsRead);
adminRouter.post('/notifications/:id/read', markNotificationRead);

// Platform admin user management
adminRouter.get('/users', listPlatformAdmins);
adminRouter.post('/users', createPlatformAdmin);
adminRouter.put('/users/:id', updatePlatformAdmin);
adminRouter.delete('/users/:id', deactivatePlatformAdmin);

// Package management
adminRouter.get('/packages', listPackages);
adminRouter.post('/packages', createPackage);
adminRouter.put('/packages/:id', updatePackage);
adminRouter.delete('/packages/:id', deactivatePackage);
