import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { chartQuerySchema } from "./schema.js";
import { getDashboardSummary, getLoanChart, getPaymentChart } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function dashboardRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/summary",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const data = await getDashboardSummary(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/loan-chart",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const { months } = chartQuerySchema.parse(req.query);
      const data = await getLoanChart(authClaims(req).tenantId, months);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/payment-chart",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const { months } = chartQuerySchema.parse(req.query);
      const data = await getPaymentChart(authClaims(req).tenantId, months);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
