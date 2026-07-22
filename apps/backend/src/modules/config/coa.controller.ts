import { Request, Response, NextFunction } from 'express';
import { coaService } from './coa.service';
import {
  AccountQuerySchema,
  CreateAccountSchema,
  MarkCashEquivalentSchema,
  UpdateAccountSchema,
  UpsertAccountMappingSchema,
} from './coa.schema';

export async function listAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = AccountQuerySchema.parse(req.query);
    const { items, meta } = await coaService.listAccounts(req.tenant.id, query);
    res.json({ success: true, data: items, meta });
  } catch (err) {
    next(err);
  }
}

export async function createAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateAccountSchema.parse(req.body);
    const account = await coaService.createAccount(req.tenant.id, data);
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

export async function updateAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateAccountSchema.parse(req.body);
    const account = await coaService.updateAccount(req.tenant.id, req.params.id, data);
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

export async function deactivateAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await coaService.deactivateAccount(req.tenant.id, req.params.id);
    res.json({ success: true, data: { message: 'Akun berhasil dinonaktifkan' } });
  } catch (err) {
    next(err);
  }
}

export async function markCashEquivalent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { isCashEquivalent } = MarkCashEquivalentSchema.parse(req.body);
    const account = await coaService.markCashEquivalent(req.tenant.id, req.params.id, isCashEquivalent);
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

export async function seedDefaultTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accounts = await coaService.seedDefaultTemplate(req.tenant.id);
    res.status(201).json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
}

export async function listMappings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await coaService.listMappings(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function upsertMapping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpsertAccountMappingSchema.parse(req.body);
    const mapping = await coaService.upsertMapping(req.tenant.id, data);
    res.json({ success: true, data: mapping });
  } catch (err) {
    next(err);
  }
}

export async function getMappingCompleteness(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await coaService.getCompleteness(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
