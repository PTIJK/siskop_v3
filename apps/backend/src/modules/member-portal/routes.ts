import { Router, type Request, type Response, type NextFunction } from "express";
import { memberAuthClaims, requireMemberAuth } from "../../middleware/member-auth.js";
import { requireParam } from "../../lib/http.js";
import { listSavingsQuerySchema, listSavingTransactionsQuerySchema } from "../savings/schema.js";
import { listLoansQuerySchema } from "../loans/schema.js";
import {
  getMemberDashboard,
  getMyLoan,
  getMySaving,
  listMyLoans,
  listMySavingTransactions,
  listMySavings
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function memberPortalRoutes(): Router {
  const router = Router();
  router.use(requireMemberAuth);

  router.get(
    "/dashboard",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const data = await getMemberDashboard(auth.tenantId, auth.memberId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/savings",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const query = listSavingsQuerySchema.parse(req.query);
      const result = await listMySavings(auth.tenantId, auth.memberId, query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.get(
    "/savings/:id",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const saving = await getMySaving(auth.tenantId, auth.memberId, requireParam(req, "id"));
      res.json({ success: true, data: saving, meta: res.locals.meta });
    })
  );

  router.get(
    "/savings/:id/transactions",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const query = listSavingTransactionsQuerySchema.parse(req.query);
      const result = await listMySavingTransactions(auth.tenantId, auth.memberId, requireParam(req, "id"), query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.get(
    "/loans",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const query = listLoansQuerySchema.parse(req.query);
      const result = await listMyLoans(auth.tenantId, auth.memberId, query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.get(
    "/loans/:id",
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const loan = await getMyLoan(auth.tenantId, auth.memberId, requireParam(req, "id"));
      res.json({ success: true, data: loan, meta: res.locals.meta });
    })
  );

  return router;
}
