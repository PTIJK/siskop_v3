-- Grants the new "market" permission module (koperasi pasar plan F3 —
-- SEED_ROLES in tenants/provision.ts) to every existing tenant's Super
-- Admin/Manager (full CRUD) and Teller/Viewer (read) roles — the same
-- defaults a newly-provisioned tenant gets. Without this, every tenant
-- provisioned before F3 shipped would 403 on every /api/market/* route,
-- since an absent "market" key reads as "not granted"
-- (middleware/rbac.ts#requirePermission). Kasir is left alone: it has no
-- market access in SEED_ROLES either.
-- The `?` containment check makes this idempotent and a no-op for any role
-- that already carries an explicit "market" key (including every role on a
-- tenant provisioned after F3 shipped).
-- tests/market-permission-backfill.test.ts runs exactly the statements
-- between the markers below.
-- backfill:start
UPDATE "Role"
SET "permissions" = "permissions" || '{"market": {"create": true, "read": true, "update": true, "delete": true}}'::jsonb
WHERE "name" IN ('Super Admin', 'Manager')
  AND NOT ("permissions" ? 'market');

UPDATE "Role"
SET "permissions" = "permissions" || '{"market": {"read": true}}'::jsonb
WHERE "name" IN ('Teller', 'Viewer')
  AND NOT ("permissions" ? 'market');
-- backfill:end
