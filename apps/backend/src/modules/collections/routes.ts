import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requirePasarEntitlement } from "../../middleware/entitlement.js";
import { requireParam } from "../../lib/http.js";
import { withIdempotency } from "../../lib/idempotency.js";
import {
  collectorChargePaymentSchema,
  collectorDepositSchema,
  collectorLoanPaymentSchema,
  listBatchesQuerySchema,
  setAssignmentsSchema,
  verifyBatchSchema
} from "./schema.js";
import {
  depositAsCollector,
  getTodayForCollector,
  listBatches,
  payChargeAsCollector,
  payLoanAsCollector,
  setAssignments,
  submitBatch,
  verifyBatch
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** `Idempotency-Key` (koperasi pasar F6) — a flaky mobile connection's retry signal. Absent is fine; see lib/idempotency.ts. */
function idempotencyKey(req: Request): string | null {
  const header = req.header("Idempotency-Key");
  return header && header.trim() !== "" ? header : null;
}

export function collectionsRoutes(): Router {
  const router = Router();
  router.use(requireAuth);
  // Kolektor & setoran is koperasi pasar's D6 add-on, same as Market above.
  router.use(requirePasarEntitlement);

  router.put(
    "/assignments",
    requirePermission("collections", "update"),
    handle(async (req, res) => {
      const data = setAssignmentsSchema.parse(req.body);
      const result = await setAssignments(authClaims(req).tenantId, data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.get(
    "/today",
    requirePermission("collections", "read"),
    handle(async (req, res) => {
      const auth = authClaims(req);
      const data = await getTodayForCollector(auth.tenantId, auth.userId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/savings-deposit",
    requirePermission("collections", "create"),
    handle(async (req, res) => {
      const data = collectorDepositSchema.parse(req.body);
      const auth = authClaims(req);
      const { status, envelope } = await withIdempotency(auth.tenantId, auth.userId, idempotencyKey(req), async () => {
        const result = await depositAsCollector(auth.tenantId, auth.userId, data);
        return { status: 201, envelope: { success: true, data: result, meta: res.locals.meta } };
      });
      res.status(status).json(envelope);
    })
  );

  router.post(
    "/loan-payment",
    requirePermission("collections", "create"),
    handle(async (req, res) => {
      const data = collectorLoanPaymentSchema.parse(req.body);
      const auth = authClaims(req);
      const { status, envelope } = await withIdempotency(auth.tenantId, auth.userId, idempotencyKey(req), async () => {
        const result = await payLoanAsCollector(auth.tenantId, auth.userId, data);
        return { status: 201, envelope: { success: true, data: result, meta: res.locals.meta } };
      });
      res.status(status).json(envelope);
    })
  );

  router.post(
    "/charge-payment",
    requirePermission("collections", "create"),
    handle(async (req, res) => {
      const data = collectorChargePaymentSchema.parse(req.body);
      const auth = authClaims(req);
      const { status, envelope } = await withIdempotency(auth.tenantId, auth.userId, idempotencyKey(req), async () => {
        const result = await payChargeAsCollector(auth.tenantId, auth.userId, data);
        return { status: 201, envelope: { success: true, data: result, meta: res.locals.meta } };
      });
      res.status(status).json(envelope);
    })
  );

  router.post(
    "/batches/:id/submit",
    requirePermission("collections", "create"),
    handle(async (req, res) => {
      const auth = authClaims(req);
      const batchId = requireParam(req, "id");
      const { status, envelope } = await withIdempotency(auth.tenantId, auth.userId, idempotencyKey(req), async () => {
        const result = await submitBatch(auth.tenantId, auth.userId, batchId);
        return { status: 200, envelope: { success: true, data: result, meta: res.locals.meta } };
      });
      res.status(status).json(envelope);
    })
  );

  router.post(
    "/batches/:id/verify",
    requirePermission("collections", "update"),
    handle(async (req, res) => {
      const data = verifyBatchSchema.parse(req.body);
      const auth = authClaims(req);
      const result = await verifyBatch(auth.tenantId, auth.userId, requireParam(req, "id"), data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.get(
    "/batches",
    requirePermission("collections", "read"),
    handle(async (req, res) => {
      const query = listBatchesQuerySchema.parse(req.query);
      const data = await listBatches(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
