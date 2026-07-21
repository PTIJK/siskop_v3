import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.middleware';
import {
  listConfigs,
  createConfig,
  updateConfig,
  getOverdue,
  list,
  findById,
  create,
  recordPayment,
} from './loans.controller';

export const loansRouter = Router();

// Config routes
loansRouter.get('/configs', requirePermission('loans', 'read'), listConfigs);
loansRouter.post('/configs', requirePermission('config', 'update'), createConfig);
loansRouter.put('/configs/:id', requirePermission('config', 'update'), updateConfig);

// /overdue MUST come before /:id to avoid route conflict
loansRouter.get('/overdue', requirePermission('loans', 'read'), getOverdue);

// Loan routes
loansRouter.get('/', requirePermission('loans', 'read'), list);
loansRouter.post('/', requirePermission('loans', 'create'), create);
loansRouter.get('/:id', requirePermission('loans', 'read'), findById);
loansRouter.post('/:id/pay', requirePermission('loans', 'update'), recordPayment);
