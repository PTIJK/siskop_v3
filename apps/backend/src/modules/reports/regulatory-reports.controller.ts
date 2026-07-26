import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startOfMonth, endOfMonth, endOfDay } from 'date-fns';
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
    const cutoff = asOfDate ? endOfDay(new Date(asOfDate)) : new Date();
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
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
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
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
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
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
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
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
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

export async function downloadNeracaPDF(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { asOfDate } = NeracaParamsSchema.parse(req.query);
    const cutoff = asOfDate ? endOfDay(new Date(asOfDate)) : new Date();
    const pdf = await regulatoryReportsService.generatePDF(req.tenant.id, 'neraca', { asOfDate: cutoff });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="neraca-${cutoff.toISOString().split('T')[0]}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function downloadArusKasPDF(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const pdf = await regulatoryReportsService.generatePDF(req.tenant.id, 'arus-kas', { from: start, to: end });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="arus-kas-${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function downloadLaporanHasilUsahaPDF(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const pdf = await regulatoryReportsService.generatePDF(req.tenant.id, 'laporan-hasil-usaha', {
      from: start,
      to: end,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laporan-hasil-usaha-${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function downloadShuDistributionPDF(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { from, to } = PeriodParamsSchema.parse(req.query);
    const start = from ? new Date(from) : startOfMonth(new Date());
    const end = to ? endOfDay(new Date(to)) : endOfMonth(new Date());
    regulatoryReportsService.assertValidPeriod(start, end);
    const pdf = await regulatoryReportsService.generatePDF(req.tenant.id, 'shu-distribution', {
      from: start,
      to: end,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="shu-distribution-${start.toISOString().split('T')[0]}_${end.toISOString().split('T')[0]}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}
