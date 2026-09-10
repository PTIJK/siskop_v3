import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireAccountingEntitlement } from "../../middleware/entitlement.js";
import { getConsolidatedAssets } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function ksuRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // Read-only, journal-derived report — same entitlement/permission gate as
  // the Neraca report it's closest to (modules/reports/routes.ts). tenantId
  // comes ONLY from authClaims — never a query param (CLAUDE.md rule 1).
  router.get(
    "/consolidated",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const data = await getConsolidatedAssets(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
