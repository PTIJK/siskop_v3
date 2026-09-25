import { Router, type Request, type Response, type NextFunction } from "express";
import { resolveReadableUnitId } from "../../lib/unit-access.js";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { chartQuerySchema, dashboardUnitQuerySchema } from "./schema.js";
import {
  getCapitalDashboard,
  getDashboardSummary,
  getGrowthDashboard,
  getLoanChart,
  getLoanQualityDashboard,
  getPaymentChart
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * The unit a dashboard figure is cut to, or undefined for the consolidated
 * one — 404 for another tenant's unit, 403 outside the caller's assignment
 * (same rules as the per-unit reports).
 */
async function dashboardUnit(req: Request): Promise<string | undefined> {
  const { unitId } = dashboardUnitQuerySchema.parse(req.query);
  if (!unitId) return undefined;
  const auth = authClaims(req);
  return resolveReadableUnitId(auth.tenantId, auth.userId, unitId);
}

export function dashboardRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/summary",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const data = await getDashboardSummary(authClaims(req).tenantId, await dashboardUnit(req));
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

  router.get(
    "/capital",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const data = await getCapitalDashboard(authClaims(req).tenantId, await dashboardUnit(req));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/loan-quality",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const data = await getLoanQualityDashboard(authClaims(req).tenantId, await dashboardUnit(req));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/growth",
    requirePermission("dashboard", "read"),
    handle(async (req, res) => {
      const data = await getGrowthDashboard(authClaims(req).tenantId, await dashboardUnit(req));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
