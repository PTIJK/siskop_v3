CREATE TABLE "KopkarRatMemberCorrection" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceRow" INTEGER NOT NULL CHECK ("sourceRow" >= 4),
  "fullName" TEXT NOT NULL,
  "nik" TEXT,
  "address" TEXT,
  "birthPlace" TEXT,
  "birthDate" TEXT,
  "occupation" TEXT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId", "sourceRow")
);

REVOKE ALL ON TABLE "KopkarRatMemberCorrection" FROM PUBLIC;
ALTER TABLE "KopkarRatMemberCorrection" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON "KopkarRatMemberCorrection" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON "KopkarRatMemberCorrection" FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "KopkarRatMemberCorrection" TO siskop_runtime;
    CREATE POLICY siskop_backend_access ON "KopkarRatMemberCorrection" FOR ALL TO siskop_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_backup') THEN
    GRANT SELECT ON "KopkarRatMemberCorrection" TO siskop_backup;
    CREATE POLICY siskop_backup_read ON "KopkarRatMemberCorrection" FOR SELECT TO siskop_backup USING (true);
  END IF;
END $$;
