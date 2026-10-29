import { Router, type NextFunction, type Request, type Response } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requireParam } from "../../lib/http.js";
import { invoiceListQuerySchema, markPaidSchema } from "./admin-schema.js";
import { getInvoice, listInvoices, markInvoicePaid, reissueInvoice, voidInvoice } from "./admin-service.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Platform owner's invoices. Mounted under /api/platform, which already requires a platform admin. */
export function invoiceAdminRoutes(): Router {
  const router = Router();

  router.get(
    "/",
    handle(async (req, res) => {
      res.json({ success: true, data: await listInvoices(invoiceListQuerySchema.parse(req.query)), meta: res.locals.meta });
    })
  );

  router.get(
    "/:id",
    handle(async (req, res) => {
      res.json({ success: true, data: await getInvoice(requireParam(req, "id")), meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/mark-paid",
    handle(async (req, res) => {
      const data = await markInvoicePaid(authClaims(req).userId, requireParam(req, "id"), markPaidSchema.parse(req.body ?? {}));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/void",
    handle(async (req, res) => {
      res.json({ success: true, data: await voidInvoice(authClaims(req).userId, requireParam(req, "id")), meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/reissue",
    handle(async (req, res) => {
      res.json({ success: true, data: await reissueInvoice(authClaims(req).userId, requireParam(req, "id")), meta: res.locals.meta });
    })
  );

  return router;
}
