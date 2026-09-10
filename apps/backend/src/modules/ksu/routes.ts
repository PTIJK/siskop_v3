import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireAccountingEntitlement } from "../../middleware/entitlement.js";
import { requireParam } from "../../lib/http.js";
import { checkUnitSegregation, getConsolidatedAssets, getMemberUnitStatement } from "./service.js";

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

  // Day 5: thin HTTP wrapper over Day 4's getMemberUnitStatement — same
  // gating as /consolidated above. `memberId` is a path param, never trusted
  // at face value: the service function scopes its lookup by the caller's own
  // tenantId and throws NOT_FOUND (404) for any id that doesn't resolve to a
  // member of that tenant (nonexistent or belonging to another tenant alike).
  router.get(
    "/members/:memberId/statement",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const data = await getMemberUnitStatement(authClaims(req).tenantId, requireParam(req, "memberId"));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // Day 5: thin HTTP wrapper over Day 4's checkUnitSegregation — same gating
  // and the same "path param scoped by tenantId, 404 on mismatch" pattern as
  // the statement route above.
  router.get(
    "/units/:unitId/segregation",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const data = await checkUnitSegregation(authClaims(req).tenantId, requireParam(req, "unitId"));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
