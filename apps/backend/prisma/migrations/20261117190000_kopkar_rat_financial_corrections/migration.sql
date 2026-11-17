CREATE TABLE "KopkarRatFinancialCorrection" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceRow" INTEGER NOT NULL CHECK ("sourceRow" >= 4),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('saving', 'loan')),
  "fields" JSONB NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId", "kind", "sourceRow")
);

REVOKE ALL ON TABLE "KopkarRatFinancialCorrection" FROM PUBLIC;
ALTER TABLE "KopkarRatFinancialCorrection" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON "KopkarRatFinancialCorrection" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON "KopkarRatFinancialCorrection" FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "KopkarRatFinancialCorrection" TO siskop_runtime;
    CREATE POLICY siskop_backend_access ON "KopkarRatFinancialCorrection" FOR ALL TO siskop_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_backup') THEN
    GRANT SELECT ON "KopkarRatFinancialCorrection" TO siskop_backup;
    CREATE POLICY siskop_backup_read ON "KopkarRatFinancialCorrection" FOR SELECT TO siskop_backup USING (true);
  END IF;
END $$;
