-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "closedWeekdays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[];

-- CreateTable
CREATE TABLE "TenantHoliday" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantHoliday_tenantId_date_key" ON "TenantHoliday"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "TenantHoliday" ADD CONSTRAINT "TenantHoliday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
