import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createStallContractSchema, endStallContractSchema, listStallContractsQuerySchema } from "./contracts.schema.js";
import { createStallContract, endStallContract, listStallContracts } from "./contracts.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Kontrak sewa kios routes (koperasi pasar F5) — composed into
 * `marketRoutes()` (routes.ts) at `/contracts`, sharing that router's
 * requireAuth + requirePasarEntitlement, same as market.ts's own /markets and
 * /stalls routes.
 */
export function contractsRoutes(): Router {
  const router = Router();

  router.get(
    "/contracts",
    requirePermission("market", "read"),
    handle(async (req, res) => {
      const query = listStallContractsQuerySchema.parse(req.query);
      const data = await listStallContracts(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/contracts",
    requirePermission("market", "create"),
    handle(async (req, res) => {
      const data = createStallContractSchema.parse(req.body);
      const contract = await createStallContract(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: contract, meta: res.locals.meta });
    })
  );

  router.post(
    "/contracts/:id/end",
    requirePermission("market", "update"),
    handle(async (req, res) => {
      const data = endStallContractSchema.parse(req.body);
      const contract = await endStallContract(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: contract, meta: res.locals.meta });
    })
  );

  return router;
}
