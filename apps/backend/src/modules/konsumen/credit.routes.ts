import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { recordCreditRepaymentSchema, searchCreditMembersQuerySchema } from "./credit.schema.js";
import { getMemberCreditStatus, recordCreditRepayment, searchMembersForCredit, toWireStatus } from "./credit.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * "Kredit Anggota" (member store credit) routes — composed into
 * `konsumenRoutes()` (product.routes.ts) at `/pos/credit/*`, not mounted
 * standalone, same as saleRoutes(). Gated on konsumen:read/update rather
 * than members:* deliberately — a Kasir role typically has konsumen but not
 * members permissions, and this is their only path to look a member up and
 * check eligibility at the register. `/members` (search) is registered
 * before `/:memberId` so it can never be shadowed as a memberId, same
 * ordering discipline product.routes.ts already uses for stock-movements.
 */
export function creditRoutes(): Router {
  const router = Router();

  router.get(
    "/pos/credit/members",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const query = searchCreditMembersQuerySchema.parse(req.query);
      const auth = authClaims(req);
      const data = await searchMembersForCredit(auth.tenantId, query.search);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/pos/credit/:memberId",
    requirePermission("konsumen", "read"),
    handle(async (req, res) => {
      const auth = authClaims(req);
      const status = await getMemberCreditStatus(auth.tenantId, requireParam(req, "memberId"));
      res.json({ success: true, data: toWireStatus(status), meta: res.locals.meta });
    })
  );

  router.post(
    "/pos/credit/repayments",
    requirePermission("konsumen", "update"),
    handle(async (req, res) => {
      const data = recordCreditRepaymentSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await recordCreditRepayment(auth.tenantId, data, auth.userId);
      res.status(201).json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
