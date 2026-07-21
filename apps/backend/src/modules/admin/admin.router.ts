import { Router } from 'express';
import {
  getDashboard,
  listTenants,
  getTenantDetail,
  updateTenant,
  getTenantStats,
  listPackages,
  createPackage,
  updatePackage,
  deactivatePackage,
} from './admin.controller';

export const adminRouter = Router();

// Dashboard
adminRouter.get('/dashboard', getDashboard);

// Tenant management
adminRouter.get('/tenants', listTenants);
adminRouter.get('/tenants/:id', getTenantDetail);
adminRouter.put('/tenants/:id', updateTenant);
adminRouter.get('/tenants/:id/stats', getTenantStats);

// Package management
adminRouter.get('/packages', listPackages);
adminRouter.post('/packages', createPackage);
adminRouter.put('/packages/:id', updatePackage);
adminRouter.delete('/packages/:id', deactivatePackage);
