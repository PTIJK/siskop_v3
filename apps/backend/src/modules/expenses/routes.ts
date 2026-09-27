import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createExpenseSchema, listExpensesQuerySchema } from "./schema.js";
import { createExpense, deleteExpense, listExpenseAccounts, listExpenses } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function expensesRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // Registered before the bare "/" list so it reads clearly as its own
  // endpoint — not required for route matching (different HTTP verbs never
  // shadow each other), just consistent with product.routes.ts's ordering
  // discipline.
  router.get(
    "/accounts",
    requirePermission("expenses", "read"),
    handle(async (req, res) => {
      const data = await listExpenseAccounts(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/",
    requirePermission("expenses", "read"),
    handle(async (req, res) => {
      const query = listExpensesQuerySchema.parse(req.query);
      const result = await listExpenses(authClaims(req).tenantId, query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.post(
    "/",
    requirePermission("expenses", "create"),
    handle(async (req, res) => {
      const data = createExpenseSchema.parse(req.body);
      const expense = await createExpense(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: expense, meta: res.locals.meta });
    })
  );

  router.delete(
    "/:id",
    requirePermission("expenses", "delete"),
    handle(async (req, res) => {
      await deleteExpense(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: { deleted: true }, meta: res.locals.meta });
    })
  );

  return router;
}
