import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import {
  createLoanConfigSchema,
  createLoanSchema,
  listLoansQuerySchema,
  loanPaymentSchema,
  updateLoanConfigSchema
} from "./schema.js";
import {
  createLoan,
  createLoanConfig,
  getLoanById,
  getOverdueLoans,
  listLoanConfigs,
  listLoans,
  recordLoanPayment,
  updateLoanConfig
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function loansRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/configs",
    requirePermission("loans", "read"),
    handle(async (req, res) => {
      const data = await listLoanConfigs(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/configs",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = createLoanConfigSchema.parse(req.body);
      const config = await createLoanConfig(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  router.put(
    "/configs/:id",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateLoanConfigSchema.parse(req.body);
      const config = await updateLoanConfig(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  // /overdue MUST be registered before /:id to avoid the route conflict.
  router.get(
    "/overdue",
    requirePermission("loans", "read"),
    handle(async (req, res) => {
      const loans = await getOverdueLoans(authClaims(req).tenantId);
      res.json({ success: true, data: loans, meta: res.locals.meta });
    })
  );

  router.get(
    "/",
    requirePermission("loans", "read"),
    handle(async (req, res) => {
      const query = listLoansQuerySchema.parse(req.query);
      const result = await listLoans(authClaims(req).tenantId, query);
      res.json({
        success: true,
        data: result.items,
        meta: { ...res.locals.meta, ...result.meta }
      });
    })
  );

  router.post(
    "/",
    requirePermission("loans", "create"),
    handle(async (req, res) => {
      const data = createLoanSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await createLoan(auth.tenantId, data, auth.userId);
      const status = "hasExistingLoan" in result && result.hasExistingLoan ? 200 : 201;
      res.status(status).json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.get(
    "/:id",
    requirePermission("loans", "read"),
    handle(async (req, res) => {
      const loan = await getLoanById(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: loan, meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/pay",
    requirePermission("loans", "update"),
    handle(async (req, res) => {
      const data = loanPaymentSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await recordLoanPayment(auth.tenantId, requireParam(req, "id"), data, auth.userId);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
