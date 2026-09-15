import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { listRegistrationRequestsQuerySchema, rejectRegistrationRequestSchema } from "./registration.schema.js";
import {
  approveRegistrationRequest,
  getSelfRegistrationLink,
  listRegistrationRequests,
  rejectRegistrationRequest
} from "./registration.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Composed into membersRoutes() (members/routes.ts) — same style as
 * konsumen/credit.routes.ts being composed into konsumenRoutes(). Every route
 * here uses the same members.create permission as manual member entry, per
 * the brief: whoever can add a member by hand can review the self-service
 * queue too.
 */
export function registrationRoutes(): Router {
  const router = Router();

  router.get(
    "/self-registration-link",
    requirePermission("members", "create"),
    handle(async (req, res) => {
      const data = await getSelfRegistrationLink(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/registration-requests",
    requirePermission("members", "create"),
    handle(async (req, res) => {
      const query = listRegistrationRequestsQuerySchema.parse(req.query);
      const result = await listRegistrationRequests(authClaims(req).tenantId, query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.post(
    "/registration-requests/:id/approve",
    requirePermission("members", "create"),
    handle(async (req, res) => {
      const auth = authClaims(req);
      const member = await approveRegistrationRequest(auth.tenantId, requireParam(req, "id"), auth.userId);
      res.json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  router.post(
    "/registration-requests/:id/reject",
    requirePermission("members", "create"),
    handle(async (req, res) => {
      const auth = authClaims(req);
      const data = rejectRegistrationRequestSchema.parse(req.body);
      const request = await rejectRegistrationRequest(auth.tenantId, requireParam(req, "id"), auth.userId, data);
      res.json({ success: true, data: request, meta: res.locals.meta });
    })
  );

  return router;
}
