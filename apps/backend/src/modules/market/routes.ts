import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createMarketSchema, createStallSchema, listStallsQuerySchema, updateMarketSchema, updateStallSchema } from "./schema.js";
import { createMarket, createStall, listMarkets, listStalls, updateMarket, updateStall } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function marketRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/markets",
    requirePermission("market", "read"),
    handle(async (req, res) => {
      const data = await listMarkets(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/markets",
    requirePermission("market", "create"),
    handle(async (req, res) => {
      const data = createMarketSchema.parse(req.body);
      const market = await createMarket(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: market, meta: res.locals.meta });
    })
  );

  router.put(
    "/markets/:id",
    requirePermission("market", "update"),
    handle(async (req, res) => {
      const data = updateMarketSchema.parse(req.body);
      const market = await updateMarket(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: market, meta: res.locals.meta });
    })
  );

  router.get(
    "/stalls",
    requirePermission("market", "read"),
    handle(async (req, res) => {
      const query = listStallsQuerySchema.parse(req.query);
      const data = await listStalls(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/stalls",
    requirePermission("market", "create"),
    handle(async (req, res) => {
      const data = createStallSchema.parse(req.body);
      const stall = await createStall(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: stall, meta: res.locals.meta });
    })
  );

  router.put(
    "/stalls/:id",
    requirePermission("market", "update"),
    handle(async (req, res) => {
      const data = updateStallSchema.parse(req.body);
      const stall = await updateStall(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: stall, meta: res.locals.meta });
    })
  );

  return router;
}
