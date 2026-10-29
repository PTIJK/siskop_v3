import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { authClaims } from "../../middleware/auth.js";
import { requireParam } from "../../lib/http.js";
import {
  addonsSchema,
  matrixSchema,
  publishSchema,
  rollbackSchema,
  simulatorQuoteSchema,
  supportPlansSchema,
  updatePackageSchema,
  updateSettingsSchema,
  upsertFeatureSchema
} from "./schema.js";
import {
  exportDraft,
  getDiff,
  getDraft,
  getVersion,
  importDraft,
  listAudit,
  listVersions,
  publish,
  rollback,
  setAddons,
  setMatrix,
  setSupportPlans,
  simulateQuote,
  updatePackage,
  updateSettings,
  upsertFeature
} from "./service.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const actor = (req: Request) => authClaims(req).userId;

/**
 * Mounted at /api/platform/pricing, behind requireAuth + requirePlatformAdmin
 * (see platform/routes.ts). Every write is audited in the service layer.
 */
export function pricingAdminRoutes(): Router {
  const router = Router();
  const ok = (res: Response, data: unknown, status = 200): void => {
    res.status(status).json({ success: true, data, meta: res.locals.meta });
  };

  router.get("/draft", handle(async (_req, res) => ok(res, await getDraft())));
  router.get("/diff", handle(async (_req, res) => ok(res, await getDiff())));

  router.put("/packages/:code", handle(async (req, res) => ok(res, await updatePackage(actor(req), requireParam(req, "code"), updatePackageSchema.parse(req.body)))));
  router.put("/features/:key", handle(async (req, res) => ok(res, await upsertFeature(actor(req), requireParam(req, "key"), upsertFeatureSchema.parse(req.body)))));
  router.put("/matrix", handle(async (req, res) => ok(res, await setMatrix(actor(req), matrixSchema.parse(req.body)))));
  router.put("/addons", handle(async (req, res) => ok(res, await setAddons(actor(req), addonsSchema.parse(req.body)))));
  router.put("/support-plans", handle(async (req, res) => ok(res, await setSupportPlans(actor(req), supportPlansSchema.parse(req.body)))));
  router.put("/settings", handle(async (req, res) => ok(res, await updateSettings(actor(req), updateSettingsSchema.parse(req.body)))));

  router.post("/quote", handle(async (req, res) => ok(res, await simulateQuote(simulatorQuoteSchema.parse(req.body)))));

  router.post("/publish", handle(async (req, res) => ok(res, await publish(actor(req), publishSchema.parse(req.body ?? {}).note), 201)));
  router.get("/versions", handle(async (_req, res) => ok(res, await listVersions())));
  router.get("/versions/:version", handle(async (req, res) => ok(res, await getVersion(z.coerce.number().int().min(1).parse(requireParam(req, "version"))))));
  router.post("/rollback", handle(async (req, res) => ok(res, await rollback(actor(req), rollbackSchema.parse(req.body).version), 201)));

  router.get("/export", handle(async (_req, res) => ok(res, await exportDraft())));
  router.post("/import", handle(async (req, res) => ok(res, await importDraft(actor(req), req.body))));

  router.get("/audit", handle(async (req, res) => ok(res, await listAudit(z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit)))));

  return router;
}
