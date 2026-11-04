import { Router } from "express";
import { requireParam } from "../../lib/http.js";
import { handle, limiter, publicJsonGuard } from "../../lib/public-guards.js";
import { authClaims } from "../../middleware/auth.js";
import {
  assignTenantReferral,
  createPartner,
  getReferralSettings,
  updatePartner,
  updateReferralSettings,
  updateTenantReferral,
  voidCommission
} from "./admin-service.js";
import { applyAsPartner, approvePartner, getPartner, listPartners, rejectPartner } from "./service.js";

/** Public partner application, mounted at /api/partners. Same guards as onboarding register. */
export function partnerPublicRoutes(): Router {
  const router = Router();
  router.use(...publicJsonGuard());
  router.post(
    "/apply",
    limiter(5, 15 * 60_000),
    handle(async (req, res) => {
      res.status(201).json({ success: true, data: await applyAsPartner(req.body), meta: res.locals.meta });
    })
  );
  return router;
}

/** Platform admin review of partners, mounted under /api/platform/partners (which already requires a platform admin). */
export function partnerAdminRoutes(): Router {
  const router = Router();
  router.get(
    "/",
    handle(async (req, res) => {
      res.json({ success: true, data: await listPartners(req.query), meta: res.locals.meta });
    })
  );
  router.post(
    "/",
    handle(async (req, res) => {
      res.status(201).json({ success: true, data: await createPartner(authClaims(req).userId, req.body), meta: res.locals.meta });
    })
  );
  router.patch(
    "/:id",
    handle(async (req, res) => {
      res.json({ success: true, data: await updatePartner(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  router.get(
    "/:id",
    handle(async (req, res) => {
      res.json({ success: true, data: await getPartner(requireParam(req, "id")), meta: res.locals.meta });
    })
  );
  router.post(
    "/:id/approve",
    handle(async (req, res) => {
      res.json({ success: true, data: await approvePartner(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  router.post(
    "/:id/reject",
    handle(async (req, res) => {
      res.json({ success: true, data: await rejectPartner(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  return router;
}

/** Routes that touch partners from the side (tenant attach, per-koperasi terms, program defaults, voids), mounted at the platform root. */
export function referralAdminRoutes(): Router {
  const router = Router();
  router.put(
    "/tenants/:id/referral",
    handle(async (req, res) => {
      res.json({ success: true, data: await assignTenantReferral(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  router.patch(
    "/referrals/:id",
    handle(async (req, res) => {
      res.json({ success: true, data: await updateTenantReferral(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  router.get(
    "/referral-settings",
    handle(async (_req, res) => {
      res.json({ success: true, data: await getReferralSettings(), meta: res.locals.meta });
    })
  );
  router.put(
    "/referral-settings",
    handle(async (req, res) => {
      res.json({ success: true, data: await updateReferralSettings(authClaims(req).userId, req.body), meta: res.locals.meta });
    })
  );
  router.post(
    "/commissions/:id/void",
    handle(async (req, res) => {
      res.json({ success: true, data: await voidCommission(authClaims(req).userId, requireParam(req, "id"), req.body), meta: res.locals.meta });
    })
  );
  return router;
}
