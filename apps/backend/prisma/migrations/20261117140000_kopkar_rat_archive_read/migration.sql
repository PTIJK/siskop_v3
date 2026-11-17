-- The approved Kopkar archive exists only in the live database. Keep its
-- table private and give the API a narrowly scoped, read-only entry point.
BEGIN;
CREATE FUNCTION public.read_kopkar_rat_archive(selected_kind text)
RETURNS TABLE (kind text, name text, "sheetCount" integer, workbook bytea, "reviewNotes" jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF to_regclass('public."KopkarRatSourceArchive"') IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT a.source_kind, a.file_name, a.sheet_count,
           CASE WHEN a.source_kind = selected_kind THEN a.workbook END,
           CASE WHEN a.source_kind = selected_kind THEN a.review_notes END
    FROM public."KopkarRatSourceArchive" a
    WHERE a.tenant_id = 'cmvpy390900018h9b1zq0c87x'
      AND a.source_kind IN ('original_master', 'original_template', 'prepared_review')
    ORDER BY a.source_kind DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.read_kopkar_rat_archive(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'siskop_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.read_kopkar_rat_archive(text) TO siskop_runtime;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.read_kopkar_rat_archive(text) FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.read_kopkar_rat_archive(text) FROM authenticated;
  END IF;
END $$;
COMMIT;
