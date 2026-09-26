import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { listAuditLogQuerySchema } from "./schema.js";
import { listAuditLogs } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function auditLogRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requirePermission("auditLog", "read"),
    handle(async (req, res) => {
      const query = listAuditLogQuerySchema.parse(req.query);
      const result = await listAuditLogs(authClaims(req).tenantId, query);
      res.json({
        success: true,
        data: result.items,
        meta: { ...res.locals.meta, ...result.meta }
      });
    })
  );

  return router;
}
