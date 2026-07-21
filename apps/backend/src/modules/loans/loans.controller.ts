import { Request, Response, NextFunction } from 'express';
import { loansService } from './loans.service';
import {
  CreateLoanConfigSchema,
  UpdateLoanConfigSchema,
  CreateLoanSchema,
  LoanPaymentSchema,
  LoanQuerySchema,
} from './loans.schema';

export async function listConfigs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await loansService.listConfigs(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateLoanConfigSchema.parse(req.body);
    const config = await loansService.createConfig(req.tenant.id, data);
    res.status(201).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = UpdateLoanConfigSchema.parse(req.body);
    const config = await loansService.updateConfig(req.tenant.id, req.params.id, data);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = LoanQuerySchema.parse(req.query);
    const result = await loansService.list(req.tenant.id, query);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function findById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const loan = await loansService.findById(req.tenant.id, req.params.id);
    res.json({ success: true, data: loan });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CreateLoanSchema.parse(req.body);
    const result = await loansService.create(req.tenant.id, data, req.user.id);
    const status = (result as { hasExistingLoan?: boolean }).hasExistingLoan ? 200 : 201;
    res.status(status).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function recordPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = LoanPaymentSchema.parse(req.body);
    const result = await loansService.recordPayment(req.tenant.id, req.params.id, data, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getOverdue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const loans = await loansService.getOverdue(req.tenant.id);
    res.json({ success: true, data: loans });
  } catch (err) {
    next(err);
  }
}
