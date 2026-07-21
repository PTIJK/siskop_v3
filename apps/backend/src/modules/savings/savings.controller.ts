import { Request, Response, NextFunction } from 'express';
import { savingsService } from './savings.service';
import {
  CreateSavingConfigSchema,
  UpdateSavingConfigSchema,
  CreateSavingSchema,
  TransactionSchema,
  SavingQuerySchema,
  TxQuerySchema,
} from './savings.schema';

export async function listConfigs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await savingsService.listConfigs(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateSavingConfigSchema.parse(req.body);
    const config = await savingsService.createConfig(req.tenant.id, data);
    res.status(201).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateSavingConfigSchema.parse(req.body);
    const config = await savingsService.updateConfig(req.tenant, req.params.id, data);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = SavingQuerySchema.parse(req.query);
    const result = await savingsService.list(req.tenant.id, query);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function findById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const saving = await savingsService.findById(req.tenant.id, req.params.id);
    res.json({ success: true, data: saving });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateSavingSchema.parse(req.body);
    const saving = await savingsService.create(req.tenant.id, data, req.user.id);
    res.status(201).json({ success: true, data: saving });
  } catch (err) {
    next(err);
  }
}

export async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { page, limit } = TxQuerySchema.parse(req.query);
    const result = await savingsService.listTransactions(
      req.tenant.id,
      req.params.id,
      page,
      limit
    );
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function deposit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = TransactionSchema.parse(req.body);
    const tx = await savingsService.deposit(req.tenant, req.params.id, data, req.user.id);
    res.status(201).json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
}

export async function withdraw(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = TransactionSchema.parse(req.body);
    const tx = await savingsService.withdraw(req.tenant, req.params.id, data, req.user.id);
    res.status(201).json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
}
