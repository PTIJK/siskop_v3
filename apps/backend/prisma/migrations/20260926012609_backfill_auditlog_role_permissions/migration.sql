-- Grants the new "auditLog" permission module (see SEED_ROLES in
-- tenants/provision.ts) to every existing tenant's Super Admin and Manager
-- roles — the same default a newly-provisioned tenant gets. Without this,
-- every tenant provisioned before this feature shipped would never see the
-- Jejak Audit tab, since an absent "auditLog" key reads as "not granted"
-- (middleware/rbac.ts#requirePermission). Teller/Viewer/Kasir are left
-- alone: an absent key already behaves identically to an explicit `{}`, so
-- there's nothing to backfill for roles that were never meant to have it.
-- The `?` containment check makes this idempotent and a no-op for any role
-- that already carries an explicit "auditLog" key (including every role on
-- a tenant provisioned after this feature shipped).
-- tests/audit-log-permission-backfill.test.ts runs exactly the statements
-- between the markers below.
-- backfill:start
UPDATE "Role"
SET "permissions" = "permissions" || '{"auditLog": {"read": true}}'::jsonb
WHERE "name" IN ('Super Admin', 'Manager')
  AND NOT ("permissions" ? 'auditLog');
-- backfill:end
