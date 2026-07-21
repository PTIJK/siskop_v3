import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.middleware';
import {
  getFinancialReport,
  downloadFinancialPDF,
  getRATReport,
  downloadRATPDF,
} from './reports.controller';

export const reportsRouter = Router();

reportsRouter.get('/financial', requirePermission('reports', 'read'), getFinancialReport);
reportsRouter.get('/financial/pdf', requirePermission('reports', 'export'), downloadFinancialPDF);
reportsRouter.get('/rat', requirePermission('reports', 'read'), getRATReport);
reportsRouter.get('/rat/pdf', requirePermission('reports', 'export'), downloadRATPDF);
