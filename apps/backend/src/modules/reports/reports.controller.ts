import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { reportsService } from './reports.service';

const FinancialParamsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const RATParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
});

export async function getFinancialReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const params = FinancialParamsSchema.parse(req.query);
    const data = await reportsService.getFinancialReport(req.tenant.id, params);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function downloadFinancialPDF(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const params = FinancialParamsSchema.parse(req.query);
    const pdf = await reportsService.generatePDF(req.tenant.id, 'financial', params);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laporan-keuangan-${Date.now()}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function getRATReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { year } = RATParamsSchema.parse(req.query);
    const data = await reportsService.getRATReport(req.tenant.id, year);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function downloadRATPDF(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { year } = RATParamsSchema.parse(req.query);
    const pdf = await reportsService.generatePDF(req.tenant.id, 'rat', { year });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laporan-rat-${year}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}
