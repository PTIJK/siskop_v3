CREATE TABLE "ExcelImportReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "reviewKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,
    CONSTRAINT "ExcelImportReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExcelImportReceipt_tenantId_draftId_reviewKey_key" ON "ExcelImportReceipt"("tenantId", "draftId", "reviewKey");
ALTER TABLE "ExcelImportReceipt" ADD CONSTRAINT "ExcelImportReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExcelImportReceipt" ADD CONSTRAINT "ExcelImportReceipt_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ExcelImportDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
