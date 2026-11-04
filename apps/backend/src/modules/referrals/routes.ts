import { Router } from "express";
import { requireParam } from "../../lib/http.js";
import { handle, limiter, publicJsonGuard } from "../../lib/public-guards.js";
import { authClaims } from "../../middleware/auth.js";
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
