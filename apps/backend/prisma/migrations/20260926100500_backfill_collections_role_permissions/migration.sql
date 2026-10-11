-- Grants the new "collections" permission module (koperasi pasar plan F4 —
-- SEED_ROLES in tenants/provision.ts) to every existing tenant's Super
-- Admin/Manager (full), Teller (read+update, to verify a batch) and Viewer
-- (read) roles, and inserts the new Kolektor role for tenants that don't
-- have one yet — the same defaults a newly-provisioned tenant gets. Without
-- this, every tenant provisioned before F4 shipped would 403 on every
-- /api/collections/* route and have no Kolektor role to assign staff to.
-- Kasir is left alone: it has no collections access in SEED_ROLES either.
-- The `?` containment check and `NOT EXISTS` make this idempotent.
-- tests/collections-permission-backfill.test.ts runs exactly the
-- statements between the markers below.
-- backfill:start
UPDATE "Role"
SET "permissions" = "permissions" || '{"collections": {"create": true, "read": true, "update": true, "delete": true}}'::jsonb
WHERE "name" IN ('Super Admin', 'Manager')
  AND NOT ("permissions" ? 'collections');

UPDATE "Role"
SET "permissions" = "permissions" || '{"collections": {"read": true, "update": true}}'::jsonb
WHERE "name" = 'Teller'
  AND NOT ("permissions" ? 'collections');

UPDATE "Role"
SET "permissions" = "permissions" || '{"collections": {"read": true}}'::jsonb
WHERE "name" = 'Viewer'
  AND NOT ("permissions" ? 'collections');

INSERT INTO "Role" ("id", "tenantId", "name", "permissions", "createdAt")
SELECT
  gen_random_uuid()::text,
  t."id",
  'Kolektor',
  '{"dashboard": {}, "members": {}, "savings": {}, "loans": {}, "reports": {}, "config": {}, "users": {}, "roles": {}, "konsumen": {}, "auditLog": {}, "market": {}, "collections": {"create": true, "read": true}}'::jsonb,
  now()
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."tenantId" = t."id" AND r."name" = 'Kolektor');
-- backfill:end
