import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { requirePermission } from '../../middleware/rbac.middleware';
import { AppError } from '../../lib/errors';
import { list, findById, create, update, deactivate, uploadKTP } from './members.controller';

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(process.env.STORAGE_PATH || './uploads', 'ktp', req.tenant.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('INVALID_FILE_TYPE', 'File harus JPG, PNG, atau PDF', 400));
    }
  },
});

export const membersRouter = Router();

membersRouter.get('/', requirePermission('members', 'read'), list);
membersRouter.post('/', requirePermission('members', 'create'), create);
membersRouter.get('/:id', requirePermission('members', 'read'), findById);
membersRouter.put('/:id', requirePermission('members', 'update'), update);
membersRouter.delete('/:id', requirePermission('members', 'delete'), deactivate);
membersRouter.post(
  '/:id/upload-ktp',
  requirePermission('members', 'update'),
  upload.single('ktp'),
  uploadKTP
);
