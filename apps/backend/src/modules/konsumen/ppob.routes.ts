import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { checkPPOBBillSchema, payPPOBBillSchema } from "./ppob.schema.js";
import { checkBill, payBill } from "./ppob.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * PPOB check/pay routes — composed into `konsumenRoutes()` (product.routes.ts)
 * at `/ppob/check` and `/ppob/pay`, same composition pattern as
 * sale.routes.ts (Phase 2 Task 3). Relies on that router's
 * `router.use(requireAuth)` already having run before a request reaches
 * these handlers.
 *
 * This is a STUB — see ppob.service.ts's module doc. `/check` needs only
 * `konsumen.read` (it writes nothing); `/pay` needs `konsumen.create` (it
 * writes a `PPOBTransaction` row), same read/write split product.routes.ts
 * and sale.routes.ts use elsewhere in this module.
 */
export function ppobRoutes(): Router {
  const router = Router();

  router.post(
    "/ppob/check",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const data = checkPPOBBillSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await checkBill(auth.tenantId, data, auth.userId);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.post(
    "/ppob/pay",
    requirePermission("konsumen", "create"),
    handle(async (req, res) => {
      const data = payPPOBBillSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await payBill(auth.tenantId, data, auth.userId);
      res.status(201).json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
