import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createLevyRateSchema, listLevyRatesQuerySchema, updateLevyRateSchema } from "./levy-rates.schema.js";
import { createLevyRate, listLevyRates, updateLevyRate } from "./levy-rates.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Tarif retribusi routes (koperasi pasar F5) — composed into `marketRoutes()`
 * (routes.ts) at `/levy-rates`, same as contracts.routes.ts's /contracts.
 */
export function levyRatesRoutes(): Router {
  const router = Router();

  router.get(
    "/levy-rates",
    requirePermission("market", "read"),
    handle(async (req, res) => {
      const query = listLevyRatesQuerySchema.parse(req.query);
      const data = await listLevyRates(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/levy-rates",
    requirePermission("market", "create"),
    handle(async (req, res) => {
      const data = createLevyRateSchema.parse(req.body);
      const rate = await createLevyRate(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: rate, meta: res.locals.meta });
    })
  );

  router.put(
    "/levy-rates/:id",
    requirePermission("market", "update"),
    handle(async (req, res) => {
      const data = updateLevyRateSchema.parse(req.body);
      const rate = await updateLevyRate(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: rate, meta: res.locals.meta });
    })
  );

  return router;
}
