import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.middleware';
import { requireSavingConfigQuota } from '../../middleware/entitlement.middleware';
import {
  listConfigs,
  createConfig,
  updateConfig,
  list,
  findById,
  create,
  listTransactions,
  deposit,
  withdraw,
} from './savings.controller';

export const savingsRouter = Router();

// Config routes
savingsRouter.get('/configs', requirePermission('savings', 'read'), listConfigs);
savingsRouter.post(
  '/configs',
  requirePermission('config', 'update'),
  requireSavingConfigQuota,
  createConfig
);
savingsRouter.put('/configs/:id', requirePermission('config', 'update'), updateConfig);

// Saving account routes
savingsRouter.get('/', requirePermission('savings', 'read'), list);
savingsRouter.post('/', requirePermission('savings', 'create'), create);
savingsRouter.get('/:id', requirePermission('savings', 'read'), findById);
savingsRouter.get('/:id/transactions', requirePermission('savings', 'read'), listTransactions);
savingsRouter.post('/:id/deposit', requirePermission('savings', 'create'), deposit);
savingsRouter.post('/:id/withdraw', requirePermission('savings', 'create'), withdraw);
