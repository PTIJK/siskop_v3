import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startOfMonth, endOfMonth } from 'date-fns';
import { regulatoryReportsService } from './regulatory-reports.service';
import { UpsertCalkNarrativeSchema } from './calk.schema';

const NeracaParamsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const PeriodParamsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function getNeraca(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { asOfDate } = NeracaParamsSchema.parse(req.query);
    const cutoff = asOfDate ? new Date(asOfDate) : new Date();
    const data = await regulatoryReportsService.getNeraca(req.tenant.id, cutoff);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getArusKas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? new Date(to) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const data = await regulatoryReportsService.getArusKas(req.tenant.id, start, end);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getLaporanHasilUsaha(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? new Date(to) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const data = await regulatoryReportsService.getLaporanHasilUsaha(req.tenant.id, start, end);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getShuDistributionReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? new Date(to) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const data = await regulatoryReportsService.getShuDistribution(req.tenant.id, start, end);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getCalk(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? new Date(to) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const data = await regulatoryReportsService.getCalk(req.tenant.id, start, end);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function upsertCalkNarrative(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { section, content } = UpsertCalkNarrativeSchema.parse(req.body);
    const data = await regulatoryReportsService.upsertCalkNarrative(req.tenant.id, section, content);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
