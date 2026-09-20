import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { salesReportQuerySchema } from "./report.schema.js";
import { getSalesReport } from "./report.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Laporan Toko routes — composed into `konsumenRoutes()` (product.routes.ts)
 * at `/reports/*`, not mounted standalone. Relies on that router's
 * `router.use(requireAuth)` already having run, same as the sale/credit routes.
 *
 * Gated on `reports:read`, NOT `konsumen:read`: the report carries HPP and
 * margin, and the Kasir/Teller roles are deliberately Toko-only with no reports
 * access (see modules/tenants/provision.ts). No accounting entitlement is
 * required — it is operational data, not journal-derived.
 */
export function reportRoutes(): Router {
  const router = Router();

  router.get(
    "/reports/sales",
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const query = salesReportQuerySchema.parse(req.query);
      const auth = authClaims(req);
      const data = await getSalesReport(auth.tenantId, query, auth.userId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
