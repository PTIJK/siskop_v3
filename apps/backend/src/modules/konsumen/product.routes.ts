import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import {
  createProductSchema,
  listProductsQuerySchema,
  listStockMovementsQuerySchema,
  recordStockMovementSchema
} from "./product.schema.js";
import { createProduct, listProducts, listStockMovements, recordStockMovement } from "./product.service.js";
import { ppobRoutes } from "./ppob.routes.js";
import { saleRoutes } from "./sale.routes.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function konsumenRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // /stock-movements is registered before /products/:id/... so the two
  // static/param route families never shadow each other, matching the
  // ordering discipline loans.routes.ts uses for /overdue vs /:id.
  router.get(
    "/products",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const query = listProductsQuerySchema.parse(req.query);
      const auth = authClaims(req);
      const data = await listProducts(auth.tenantId, query, auth.userId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/products",
    requirePermission("konsumen", "create"),
    handle(async (req, res) => {
      const data = createProductSchema.parse(req.body);
      const auth = authClaims(req);
      const product = await createProduct(auth.tenantId, data, auth.userId);
      res.status(201).json({ success: true, data: product, meta: res.locals.meta });
    })
  );

  router.post(
    "/products/:id/stock-movements",
    requirePermission("konsumen", "update"),
    handle(async (req, res) => {
      const data = recordStockMovementSchema.parse(req.body);
      const auth = authClaims(req);
      const product = await recordStockMovement(auth.tenantId, requireParam(req, "id"), data, auth.userId);
      res.status(201).json({ success: true, data: product, meta: res.locals.meta });
    })
  );

  router.get(
    "/stock-movements",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const query = listStockMovementsQuerySchema.parse(req.query);
      const auth = authClaims(req);
      const data = await listStockMovements(auth.tenantId, query, auth.userId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // Phase 2 Task 3 — /pos/sales, composed here so it shares this router's
  // requireAuth and mounts at the same /api/konsumen prefix (app.ts is
  // unchanged).
  router.use(saleRoutes());

  // Phase 2 Task 4 — /ppob/check and /ppob/pay (stub), composed the same way.
  router.use(ppobRoutes());

  return router;
}
