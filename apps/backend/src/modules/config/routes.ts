import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireAccountingEntitlement, requireWhitelabelEntitlement } from "../../middleware/entitlement.js";
import { requireParam } from "../../lib/http.js";
import { listReadableUnits } from "../../lib/unit-access.js";
import {
  createAccountSchema,
  createHolidaySchema,
  createRoleSchema,
  importHolidaysSchema,
  listHolidaysQuerySchema,
  updateOperatingDaysSchema,
  createUnitSchema,
  updateAccountSchema,
  updateModalDisetorSchema,
  updateRoleSchema,
  updateSelfRegistrationSchema,
  updateUnitSchema,
  upsertAccountMappingSchema,
  upsertShuDistributionConfigSchema,
  upsertWhitelabelConfigSchema
} from "./schema.js";
import {
  createAccount,
  createRole,
  createUnit,
  deleteAccountMapping,
  deleteRole,
  generateStandardCoa,
  getModalDisetor,
  getSelfRegistrationConfig,
  getShuDistributionConfig,
  getUnpostedJournalSummary,
  getWhitelabelConfig,
  listAccountMappings,
  listAccounts,
  listRoles,
  listUnits,
  repostUnpostedJournalEntries,
  updateAccount,
  updateModalDisetor,
  updateRole,
  updateSelfRegistrationConfig,
  updateUnit,
  upsertAccountMapping,
  upsertShuDistributionConfig,
  upsertWhitelabelConfig
} from "./service.js";
import {
  createHoliday,
  deleteHoliday,
  getOperatingDays,
  importHolidays,
  listHolidays,
  updateOperatingDays
} from "./calendar.service.js";

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

  // "Which units may I open?" — answered from the caller's OWN unit assignment (their
  // UserUnit rows, else every unit of the tenant), so it needs no module permission:
  // /units above is the tenant's full list and needs config.read, which a Kasir
  // (Toko-only, `config: {}`) deliberately lacks. It only ever returns units the caller
  // can already act on or read, so it discloses nothing new.
  router.get(
    "/units/mine",
    handle(async (req, res) => {
      const auth = authClaims(req);
      const data = await listReadableUnits(auth.tenantId, auth.userId);
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
    requireAccountingEntitlement,
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await listAccounts(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/accounts",
    requireAccountingEntitlement,
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = createAccountSchema.parse(req.body);
      const account = await createAccount(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: account, meta: res.locals.meta });
    })
  );

  router.put(
    "/accounts/:id",
    requireAccountingEntitlement,
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const data = updateAccountSchema.parse(req.body);
      const account = await updateAccount(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: account, meta: res.locals.meta });
    })
  );

  router.post(
    "/accounts/generate-standard",
    requireAccountingEntitlement,
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const result = await generateStandardCoa(authClaims(req).tenantId);
      const status = result.accountsCreated + result.mappingsCreated > 0 ? 201 : 200;
      res.status(status).json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  // ── Unposted journal entries (transactions made before their mapping existed) ─

  router.get(
    "/journal/unposted",
    requireAccountingEntitlement,
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await getUnpostedJournalSummary(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/journal/repost",
    requireAccountingEntitlement,
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = await repostUnpostedJournalEntries(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // ── Account Mappings ─────────────────────────────────────────────────────────

  router.get(
    "/account-mappings",
    requireAccountingEntitlement,
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await listAccountMappings(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/account-mappings",
    requireAccountingEntitlement,
    requirePermission("accounting", "create"),
    handle(async (req, res) => {
      const data = upsertAccountMappingSchema.parse(req.body);
      const { mapping, created } = await upsertAccountMapping(authClaims(req).tenantId, data);
      res.status(created ? 201 : 200).json({ success: true, data: mapping, meta: res.locals.meta });
    })
  );

  router.delete(
    "/account-mappings/:id",
    requireAccountingEntitlement,
    requirePermission("accounting", "delete"),
    handle(async (req, res) => {
      await deleteAccountMapping(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: { deleted: true }, meta: res.locals.meta });
    })
  );

  // ── SHU Distribution ─────────────────────────────────────────────────────────

  router.get(
    "/shu-distribution",
    requireAccountingEntitlement,
    requirePermission("accounting", "read"),
    handle(async (req, res) => {
      const data = await getShuDistributionConfig(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/shu-distribution",
    requireAccountingEntitlement,
    requirePermission("accounting", "update"),
    handle(async (req, res) => {
      const data = upsertShuDistributionConfigSchema.parse(req.body);
      const config = await upsertShuDistributionConfig(authClaims(req).tenantId, data);
      res.json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  // ── Whitelabel ───────────────────────────────────────────────────────────────
  // Read is ungated (frozen values stay visible); writes require whitelabelEnabled.

  router.get(
    "/whitelabel",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const data = await getWhitelabelConfig(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/whitelabel",
    requirePermission("config", "update"),
    requireWhitelabelEntitlement,
    handle(async (req, res) => {
      const data = upsertWhitelabelConfigSchema.parse(req.body);
      const config = await upsertWhitelabelConfig(authClaims(req).tenantId, data);
      res.json({ success: true, data: config, meta: res.locals.meta });
    })
  );

  // ── Modal Disetor ────────────────────────────────────────────────────────────

  router.get(
    "/modal-disetor",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const data = await getModalDisetor(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/modal-disetor",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateModalDisetorSchema.parse(req.body);
      const result = await updateModalDisetor(authClaims(req).tenantId, data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  // ── Self Registration ────────────────────────────────────────────────────────
  // PUT, not PATCH — every "update a tenant setting" endpoint in this module
  // (modal-disetor, whitelabel, units) uses PUT, so this matches rather than
  // introducing the only PATCH route in the codebase.

  router.get(
    "/self-registration",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const data = await getSelfRegistrationConfig(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/self-registration",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateSelfRegistrationSchema.parse(req.body);
      const result = await updateSelfRegistrationConfig(authClaims(req).tenantId, data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  // ── Operating calendar (hari libur & hari tutup) ─────────────────────────

  router.get(
    "/holidays",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const query = listHolidaysQuerySchema.parse(req.query);
      const data = await listHolidays(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/holidays",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = createHolidaySchema.parse(req.body);
      const holiday = await createHoliday(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: holiday, meta: res.locals.meta });
    })
  );

  router.post(
    "/holidays/import",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = importHolidaysSchema.parse(req.body);
      const result = await importHolidays(authClaims(req).tenantId, data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.delete(
    "/holidays/:id",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const result = await deleteHoliday(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  router.get(
    "/operating-days",
    requirePermission("config", "read"),
    handle(async (req, res) => {
      const data = await getOperatingDays(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.put(
    "/operating-days",
    requirePermission("config", "update"),
    handle(async (req, res) => {
      const data = updateOperatingDaysSchema.parse(req.body);
      const result = await updateOperatingDays(authClaims(req).tenantId, data);
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
