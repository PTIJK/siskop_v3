import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import {
  createSavingConfigSchema,
  createSavingSchema,
  listSavingTransactionsQuerySchema,
  listSavingsQuerySchema,
  savingTransactionSchema,
  updateSavingConfigSchema
} from "./schema.js";
import {
  createSaving,
  createSavingConfig,
  depositToSaving,
  getSavingById,
  listSavingConfigs,
  listSavingTransactions,
  listSavings,
  updateSavingConfig,
  withdrawFromSaving
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function savingsRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/configs",
    requirePermission("savings", "read"),
    handle(async (req, res) => {
      const data = await listSavingConfigs(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // Config creation is gated on config:update, not savings:* — a deliberate
  // quirk preserved from the pre-rescaffold system's RBAC design.
  router.post(
    "/configs",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = createSavingConfigSchema.parse(req.body);
      const config = await createSavingConfig(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  router.put(
    "/configs/:id",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateSavingConfigSchema.parse(req.body);
      const config = await updateSavingConfig(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  router.get(
    "/",
    requirePermission("savings", "read"),
    handle(async (req, res) => {
      const query = listSavingsQuerySchema.parse(req.query);
      const result = await listSavings(authClaims(req).tenantId, query);
      res.json({
        success: true,
        data: result.items,
        meta: { ...res.locals.meta, ...result.meta }
      });
    })
  );

  router.post(
    "/",
    requirePermission("savings", "create"),
    handle(async (req, res) => {
      const data = createSavingSchema.parse(req.body);
      const auth = authClaims(req);
      const saving = await createSaving(auth.tenantId, data, auth.userId);
      res.status(201).json({ success: true, data: saving, meta: res.locals.meta });
    })
  );

  router.get(
    "/:id",
    requirePermission("savings", "read"),
    handle(async (req, res) => {
      const saving = await getSavingById(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: saving, meta: res.locals.meta });
    })
  );

  router.get(
    "/:id/transactions",
    requirePermission("savings", "read"),
    handle(async (req, res) => {
      const query = listSavingTransactionsQuerySchema.parse(req.query);
      const result = await listSavingTransactions(
        authClaims(req).tenantId,
        requireParam(req, "id"),
        query
      );
      res.json({
        success: true,
        data: result.items,
        meta: { ...res.locals.meta, ...result.meta }
      });
    })
  );

  router.post(
    "/:id/deposit",
    requirePermission("savings", "create"),
    handle(async (req, res) => {
      const data = savingTransactionSchema.parse(req.body);
      const auth = authClaims(req);
      const transaction = await depositToSaving(auth.tenantId, requireParam(req, "id"), data, auth.userId);
      res.status(201).json({ success: true, data: transaction, meta: res.locals.meta });
    })
  );

  router.post(
    "/:id/withdraw",
    requirePermission("savings", "create"),
    handle(async (req, res) => {
      const data = savingTransactionSchema.parse(req.body);
      const auth = authClaims(req);
      const transaction = await withdrawFromSaving(
        auth.tenantId,
        requireParam(req, "id"),
        data,
        auth.userId
      );
      res.status(201).json({ success: true, data: transaction, meta: res.locals.meta });
    })
  );

  return router;
}
