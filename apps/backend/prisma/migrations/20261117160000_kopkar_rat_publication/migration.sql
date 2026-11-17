CREATE TABLE "KopkarRatPublication" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('member', 'saving', 'loan')),
  "sourceRow" INTEGER NOT NULL CHECK ("sourceRow" >= 4),
  "recordKey" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "publishedBy" TEXT NOT NULL,
  "batchHash" TEXT NOT NULL,
  "journalEntryNo" INTEGER,
  "verificationRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "kind", "sourceRow"),
  UNIQUE ("tenantId", "kind", "recordKey")
);
CREATE INDEX "KopkarRatPublication_tenantId_batchHash_idx" ON "KopkarRatPublication"("tenantId", "batchHash");

REVOKE ALL ON TABLE "KopkarRatPublication" FROM PUBLIC;
ALTER TABLE "KopkarRatPublication" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE "KopkarRatPublication" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE "KopkarRatPublication" FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_runtime') THEN
    GRANT SELECT, INSERT ON TABLE "KopkarRatPublication" TO siskop_runtime;
    CREATE POLICY siskop_backend_access ON "KopkarRatPublication" FOR ALL TO siskop_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='siskop_backup') THEN
    GRANT SELECT ON TABLE "KopkarRatPublication" TO siskop_backup;
    CREATE POLICY siskop_backup_read ON "KopkarRatPublication" FOR SELECT TO siskop_backup USING (true);
  END IF;
END $$;
