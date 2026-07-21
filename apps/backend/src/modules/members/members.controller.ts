import { Request, Response, NextFunction } from 'express';
import { membersService } from './members.service';
import { CreateMemberSchema, UpdateMemberSchema, MemberQuerySchema } from './members.schema';
import { AppError } from '../../lib/errors';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = MemberQuerySchema.parse(req.query);
    const result = await membersService.list(req.tenant.id, query);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function findById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await membersService.findById(req.tenant.id, req.params.id);
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateMemberSchema.parse(req.body);
    const member = await membersService.create(req.tenant.id, req.tenant.slug, data);
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateMemberSchema.parse(req.body);
    const member = await membersService.update(req.tenant.id, req.params.id, data);
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await membersService.deactivate(req.tenant.id, req.params.id);
    res.json({ success: true, data: { message: 'Anggota berhasil dinonaktifkan' } });
  } catch (err) {
    next(err);
  }
}

export async function uploadKTP(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError('NO_FILE', 'File KTP wajib diunggah', 400);
    }
    const member = await membersService.uploadKTP(req.tenant.id, req.params.id, req.file.path);
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}
