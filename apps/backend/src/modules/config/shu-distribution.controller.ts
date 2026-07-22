import { Request, Response, NextFunction } from 'express';
import { shuDistributionService } from './shu-distribution.service';
import { UpsertShuDistributionSchema } from './shu-distribution.schema';

export async function getShuDistributionConfig(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await shuDistributionService.get(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function upsertShuDistributionConfig(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = UpsertShuDistributionSchema.parse(req.body);
    const config = await shuDistributionService.upsert(req.tenant.id, data);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}
