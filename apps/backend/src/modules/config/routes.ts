import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import {
  createAccountSchema,
  createRoleSchema,
  createUnitSchema,
  updateAccountSchema,
  updateRoleSchema,
  updateUnitSchema,
  upsertAccountMappingSchema,
  upsertShuDistributionConfigSchema
} from "./schema.js";
import {
  createAccount,
  createRole,
  createUnit,
  deleteAccountMapping,
  deleteRole,
  getShuDistributionConfig,
  listAccountMappings,
  listAccounts,
  listRoles,
  listUnits,
  updateAccount,
  updateRole,
  updateUnit,
  upsertAccountMapping,
  upsertShuDistributionConfig
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function configRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // ── Units ──────────────────────────────────────────────────────────────────

  router.get(
    "/units",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const data = await listUnits(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/units",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = createUnitSchema.parse(req.body);
      const unit = await createUnit(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: unit, meta: res.locals.meta });
    })
  );

  router.put(
    "/units/:id",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateUnitSchema.parse(req.body);
      const unit = await updateUnit(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: unit, meta: res.locals.meta });
    })
  );

  // ── Roles ──────────────────────────────────────────────────────────────────

  router.get(
    "/roles",
    requirePermission("roles", "read"),
    handle(async (req, res) => {
      const data = await listRoles(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/roles",
    requirePermission("roles", "create"),
    handle(async (req, res) => {
      const data = createRoleSchema.parse(req.body);
      const role = await createRole(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: role, meta: res.locals.meta });
    })
  );

  router.put(
    "/roles/:id",
    requirePermission("roles", "update"),
    handle(async (req, res) => {
      const data = updateRoleSchema.parse(req.body);
      const role = await updateRole(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: role, meta: res.locals.meta });
    })
  );

  router.delete(
    "/roles/:id",
    requirePermission("roles", "delete"),
    handle(async (req, res) => {
      await deleteRole(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: { deleted: true }, meta: res.locals.meta });
    })
  );

  // ── Accounts (Chart of Accounts) ─────────────────────────────────────────────

  router.get(
    "/accounts",
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await listAccounts(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/accounts",
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = createAccountSchema.parse(req.body);
      const account = await createAccount(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: account, meta: res.locals.meta });
    })
  );

  router.put(
    "/accounts/:id",
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const data = updateAccountSchema.parse(req.body);
      const account = await updateAccount(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: account, meta: res.locals.meta });
    })
  );

  // ── Account Mappings ─────────────────────────────────────────────────────────

  router.get(
    "/account-mappings",
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await listAccountMappings(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/account-mappings",
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = upsertAccountMappingSchema.parse(req.body);
      const { mapping, created } = await upsertAccountMapping(authClaims(req).tenantId, data);
      res.status(created ? 201 : 200).json({ success: true, data: mapping, meta: res.locals.meta });
    })
  );

  router.delete(
    "/account-mappings/:id",
    requirePermission("accounting", "delete"),
    handle(async (req, res) => {
      await deleteAccountMapping(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: { deleted: true }, meta: res.locals.meta });
    })
  );

  // ── SHU Distribution ─────────────────────────────────────────────────────────

  router.get(
    "/shu-distribution",
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await getShuDistributionConfig(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/shu-distribution",
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const data = upsertShuDistributionConfigSchema.parse(req.body);
      const config = await upsertShuDistributionConfig(authClaims(req).tenantId, data);
      res.json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  return router;
}
