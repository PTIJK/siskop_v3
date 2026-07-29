import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePlatformAdmin } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import {
  createPackageSchema,
  createPlatformAdminSchema,
  updatePackageSchema,
  updatePlatformAdminSchema,
  updateTenantStatusSchema
} from "./schema.js";
import {
  createPackage,
  createPlatformAdmin,
  createTenant,
  deactivatePackage,
  deactivatePlatformAdmin,
  listPackages,
  listPlatformAdmins,
  listTenants,
  updatePackage,
  updatePlatformAdmin,
  updateTenantStatus
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function platformRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requirePlatformAdmin);

  router.get(
    "/tenants",
    handle(async (_req, res) => {
      const data = await listTenants();
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/tenants",
    handle(async (req, res) => {
      const tenant = await createTenant(req.body);
      res.status(201).json({ success: true, data: tenant, meta: res.locals.meta });
    })
  );

  router.put(
    "/tenants/:id",
    handle(async (req, res) => {
      const data = updateTenantStatusSchema.parse(req.body);
      const tenant = await updateTenantStatus(requireParam(req, "id"), data);
      res.json({ success: true, data: tenant, meta: res.locals.meta });
    })
  );

  // ── Subscription Packages ─────────────────────────────────────────────────────

  router.get(
    "/packages",
    handle(async (_req, res) => {
      const data = await listPackages();
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/packages",
    handle(async (req, res) => {
      const data = createPackageSchema.parse(req.body);
      const pkg = await createPackage(data);
      res.status(201).json({ success: true, data: pkg, meta: res.locals.meta });
    })
  );

  router.put(
    "/packages/:id",
    handle(async (req, res) => {
      const data = updatePackageSchema.parse(req.body);
      const pkg = await updatePackage(requireParam(req, "id"), data);
      res.json({ success: true, data: pkg, meta: res.locals.meta });
    })
  );

  router.delete(
    "/packages/:id",
    handle(async (req, res) => {
      const pkg = await deactivatePackage(requireParam(req, "id"));
      res.json({ success: true, data: pkg, meta: res.locals.meta });
    })
  );

  // ── Platform Admin Users ───────────────────────────────────────────────────────

  router.get(
    "/admins",
    handle(async (_req, res) => {
      const data = await listPlatformAdmins();
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/admins",
    handle(async (req, res) => {
      const data = createPlatformAdminSchema.parse(req.body);
      const auth = authClaims(req);
      const admin = await createPlatformAdmin({ tenantId: auth.tenantId, roleId: auth.roleId }, data);
      res.status(201).json({ success: true, data: admin, meta: res.locals.meta });
    })
  );

  router.put(
    "/admins/:id",
    handle(async (req, res) => {
      const data = updatePlatformAdminSchema.parse(req.body);
      const admin = await updatePlatformAdmin(requireParam(req, "id"), data);
      res.json({ success: true, data: admin, meta: res.locals.meta });
    })
  );

  router.delete(
    "/admins/:id",
    handle(async (req, res) => {
      const auth = authClaims(req);
      await deactivatePlatformAdmin(requireParam(req, "id"), auth.userId);
      res.json({ success: true, data: { deactivated: true }, meta: res.locals.meta });
    })
  );

  return router;
}
