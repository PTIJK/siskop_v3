import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { requirePermission } from '../../middleware/rbac.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  requireWhitelabelEntitlement,
  requireAccountingEntitlement,
} from '../../middleware/entitlement.middleware';
import { AppError } from '../../lib/errors';
import {
  getProfile,
  updateProfile,
  uploadLogo,
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getWhitelabel,
  upsertWhitelabel,
} from './config.controller';
import {
  listAccounts,
  createAccount,
  updateAccount,
  deactivateAccount,
  markCashEquivalent,
  seedDefaultTemplate,
  listMappings,
  upsertMapping,
  getMappingCompleteness,
} from './coa.controller';
import { getShuDistributionConfig, upsertShuDistributionConfig } from './shu-distribution.controller';
import { getModalDisetor, updateModalDisetor } from './modal-disetor.controller';

const logoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(process.env.STORAGE_PATH || './uploads', 'logos', req.tenant.id);
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

export const configRouter = Router();

// Profile — any authenticated user can read/update their own
configRouter.get('/profile', authMiddleware, getProfile);
configRouter.put('/profile', authMiddleware, updateProfile);
configRouter.post('/logo', requirePermission('config', 'update'), logoUpload.single('logo'), uploadLogo);

// User management
configRouter.get('/users', requirePermission('users', 'read'), listUsers);
configRouter.post('/users', requirePermission('users', 'create'), createUser);
configRouter.put('/users/:id', requirePermission('users', 'update'), updateUser);
configRouter.delete('/users/:id', requirePermission('users', 'delete'), deactivateUser);

// Role management
configRouter.get('/roles', requirePermission('roles', 'read'), listRoles);
configRouter.post('/roles', requirePermission('roles', 'create'), createRole);
configRouter.put('/roles/:id', requirePermission('roles', 'update'), updateRole);
configRouter.delete('/roles/:id', requirePermission('roles', 'delete'), deleteRole);

// Whitelabel — read allowed regardless of entitlement (frozen values stay visible);
// writes require the tenant's package to have whitelabelEnabled
configRouter.get('/whitelabel', requirePermission('config', 'read'), getWhitelabel);
configRouter.put(
  '/whitelabel',
  requirePermission('config', 'update'),
  requireWhitelabelEntitlement,
  upsertWhitelabel
);

// Konfigurasi Akun (COA) — gated by the "accounting" package module entitlement
configRouter.get(
  '/accounts',
  requireAccountingEntitlement,
  requirePermission('accounting', 'read'),
  listAccounts
);
configRouter.post(
  '/accounts',
  requireAccountingEntitlement,
  requirePermission('accounting', 'create'),
  createAccount
);
configRouter.put(
  '/accounts/:id',
  requireAccountingEntitlement,
  requirePermission('accounting', 'update'),
  updateAccount
);
configRouter.delete(
  '/accounts/:id',
  requireAccountingEntitlement,
  requirePermission('accounting', 'delete'),
  deactivateAccount
);
configRouter.post(
  '/accounts/seed-default',
  requireAccountingEntitlement,
  requirePermission('accounting', 'create'),
  seedDefaultTemplate
);
configRouter.post(
  '/accounts/:id/mark-cash-equivalent',
  requireAccountingEntitlement,
  requirePermission('accounting', 'update'),
  markCashEquivalent
);

configRouter.get(
  '/account-mappings',
  requireAccountingEntitlement,
  requirePermission('accounting', 'read'),
  listMappings
);
configRouter.put(
  '/account-mappings',
  requireAccountingEntitlement,
  requirePermission('accounting', 'update'),
  upsertMapping
);
configRouter.get(
  '/account-mappings/completeness',
  requireAccountingEntitlement,
  requirePermission('accounting', 'read'),
  getMappingCompleteness
);

// Daftar Pembagian SHU per Anggota — distribution formula config (Design Spec §5.4)
configRouter.get(
  '/shu-distribution',
  requireAccountingEntitlement,
  requirePermission('accounting', 'read'),
  getShuDistributionConfig
);
configRouter.put(
  '/shu-distribution',
  requireAccountingEntitlement,
  requirePermission('accounting', 'update'),
  upsertShuDistributionConfig
);

// Modal disetor — compliance field for the Permenkop UKM No. 2/2024 Pasal 12
// mandatory-audit threshold (Rp5M). Not gated by "accounting" entitlement: this
// is a general tenant compliance field, independent of the Konfigurasi Akun module.
configRouter.get('/modal-disetor', requirePermission('config', 'read'), getModalDisetor);
configRouter.put('/modal-disetor', requirePermission('config', 'update'), updateModalDisetor);
