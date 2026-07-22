import { Request, Response, NextFunction } from 'express';
import { modalDisetorService } from './modal-disetor.service';
import { UpdateModalDisetorSchema } from './modal-disetor.schema';

export async function getModalDisetor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await modalDisetorService.get(req.tenant.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateModalDisetor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { modalDisetor } = UpdateModalDisetorSchema.parse(req.body);
    const data = await modalDisetorService.update(req.tenant.id, modalDisetor);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
