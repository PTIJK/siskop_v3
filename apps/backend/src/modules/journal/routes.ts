import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requireAccountingEntitlement } from "../../middleware/entitlement.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createManualJournalSchema, reverseManualJournalSchema, yearCloseBodySchema, yearCloseParamsSchema } from "./schema.js";
import { createManualJournal, reverseManualJournal } from "./service.js";
import { closeYear, listYearCloses, planYearClose, reopenYear } from "./year-close.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// Manual journals are accounting-configuration work, so they sit behind the same
// package module and `accounting` permission as the Chart of Accounts.
export function journalRoutes(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireAccountingEntitlement);

  router.post(
    "/",
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = createManualJournalSchema.parse(req.body);
      const { tenantId, userId } = authClaims(req);
      const entry = await createManualJournal(tenantId, userId, data);
      res.status(201).json({ success: true, data: entry, meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/reverse",
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = reverseManualJournalSchema.parse(req.body ?? {});
      const { tenantId, userId } = authClaims(req);
      const entry = await reverseManualJournal(tenantId, userId, requireParam(req, "id"), data);
      res.status(201).json({ success: true, data: entry, meta: res.locals.meta });
    })
  );

  // ── Tutup Buku ─────────────────────────────────────────────────────────────

  router.get(
    "/year-close",
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      res.json({ success: true, data: await listYearCloses(authClaims(req).tenantId), meta: res.locals.meta });
    })
  );

  router.get(
    "/year-close/:year/preview",
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const { year } = yearCloseParamsSchema.parse(req.params);
      const data = await planYearClose(authClaims(req).tenantId, year);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/year-close/:year",
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const { year } = yearCloseParamsSchema.parse(req.params);
      const { targetAccountId } = yearCloseBodySchema.parse(req.body ?? {});
      const { tenantId, userId } = authClaims(req);
      const data = await closeYear(tenantId, userId, year, targetAccountId);
      res.status(201).json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/year-close/:year/reopen",
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const { year } = yearCloseParamsSchema.parse(req.params);
      const { tenantId, userId } = authClaims(req);
      const data = await reopenYear(tenantId, userId, year);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
