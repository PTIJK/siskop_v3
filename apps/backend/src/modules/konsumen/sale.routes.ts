import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { createSaleSchema, listSalesQuerySchema } from "./sale.schema.js";
import { createSale, listSales } from "./sale.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * POS sale routes — composed into `konsumenRoutes()` (product.routes.ts) at
 * `/pos/sales`, not mounted standalone. Relies on that router's
 * `router.use(requireAuth)` already having run before a request reaches
 * these handlers, same as its /products and /stock-movements routes.
 */
export function saleRoutes(): Router {
  const router = Router();

  router.post(
    "/pos/sales",
    requirePermission("konsumen", "create"),
    handle(async (req, res) => {
      const data = createSaleSchema.parse(req.body);
      const auth = authClaims(req);
      const sale = await createSale(auth.tenantId, data, auth.userId);
      res.status(201).json({ success: true, data: sale, meta: res.locals.meta });
    })
  );

  router.get(
    "/pos/sales",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const query = listSalesQuerySchema.parse(req.query);
      const auth = authClaims(req);
      const data = await listSales(auth.tenantId, query, auth.userId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
