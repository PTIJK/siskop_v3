import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { dashboardService } from './dashboard.service';

const ChartQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await dashboardService.getSummary(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getLoanChart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { months } = ChartQuerySchema.parse(req.query);
    const data = await dashboardService.getLoanChart(req.tenant.id, months);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getPaymentChart(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { months } = ChartQuerySchema.parse(req.query);
    const data = await dashboardService.getPaymentChart(req.tenant.id, months);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
