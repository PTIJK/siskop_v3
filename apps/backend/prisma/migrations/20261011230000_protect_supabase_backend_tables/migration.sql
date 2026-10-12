-- SISKOP authenticates through its backend. Supabase's public API roles must
-- never access its application tables directly. Ordinary PostgreSQL test and
-- Cloud SQL databases do not have these roles, so their behavior is unchanged.
DO $protect$
DECLARE
  application_table record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
    FOR application_table IN
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', application_table.tablename);
    END LOOP;
    ALTER FUNCTION public.reserve_tenant_slug() SET search_path = public, pg_temp;
    ALTER FUNCTION public.link_user_identity() SET search_path = public, pg_temp;
  END IF;
END
$protect$;
