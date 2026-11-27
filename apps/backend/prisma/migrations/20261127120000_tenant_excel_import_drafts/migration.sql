CREATE TABLE "ExcelImportDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "limited" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExcelImportDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExcelImportDraft_tenantId_fileHash_key" ON "ExcelImportDraft"("tenantId", "fileHash");
CREATE INDEX "ExcelImportDraft_tenantId_createdAt_id_idx" ON "ExcelImportDraft"("tenantId", "createdAt", "id");
ALTER TABLE "ExcelImportDraft" ADD CONSTRAINT "ExcelImportDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
