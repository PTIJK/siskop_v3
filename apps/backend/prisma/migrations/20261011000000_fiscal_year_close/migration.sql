-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'CLOSING';

-- CreateTable
CREATE TABLE "FiscalYearClose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,

    CONSTRAINT "FiscalYearClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalYearClose_tenantId_idx" ON "FiscalYearClose"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_tenantId_year_key" ON "FiscalYearClose"("tenantId", "year");

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
