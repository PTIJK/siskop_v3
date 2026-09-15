-- Keep aliases reserved even while a previous API revision is serving traffic.
-- The conflict update locks an existing reservation before checking ownership.
CREATE FUNCTION reserve_tenant_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  INSERT INTO "TenantSlugReservation" ("slug", "tenantId") VALUES (NEW."slug", NEW."id")
  ON CONFLICT ("slug") DO UPDATE SET "slug" = EXCLUDED."slug"
  RETURNING "tenantId" INTO owner_id;
  IF owner_id <> NEW."id" THEN
    RAISE unique_violation USING MESSAGE = 'Tenant address is reserved', CONSTRAINT = 'TenantSlugReservation_pkey';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_slug_reservation AFTER INSERT OR UPDATE OF "slug" ON "Tenant"
FOR EACH ROW EXECUTE FUNCTION reserve_tenant_slug();
