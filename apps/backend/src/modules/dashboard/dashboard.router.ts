import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.middleware';
import { getSummary, getLoanChart, getPaymentChart } from './dashboard.controller';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', requirePermission('dashboard', 'read'), getSummary);
dashboardRouter.get('/loan-chart', requirePermission('dashboard', 'read'), getLoanChart);
dashboardRouter.get('/payment-chart', requirePermission('dashboard', 'read'), getPaymentChart);
