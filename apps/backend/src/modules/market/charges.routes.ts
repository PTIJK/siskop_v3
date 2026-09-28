import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { listChargesQuerySchema, payChargeSchema } from "./charges.schema.js";
import { listCharges, payCharge } from "./charges.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Tagihan (sewa/retribusi) routes (koperasi pasar F5) — composed into
 * `marketRoutes()` (routes.ts) at `/charges`. `/charges/:id/pay` here is the
 * loket path; a Kolektor pays through `/api/collections/charge-payment`
 * instead (modules/collections), both going through charges.service.ts#payCharge.
 */
export function chargesRoutes(): Router {
  const router = Router();

  router.get(
    "/charges",
    requirePermission("market", "read"),
    handle(async (req, res) => {
      const query = listChargesQuerySchema.parse(req.query);
      const data = await listCharges(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/charges/:id/pay",
    requirePermission("market", "update"),
    handle(async (req, res) => {
      const data = payChargeSchema.parse(req.body);
      const auth = authClaims(req);
      const charge = await payCharge(auth.tenantId, requireParam(req, "id"), data, auth.userId);
      res.json({ success: true, data: charge, meta: res.locals.meta });
    })
  );

  return router;
}
