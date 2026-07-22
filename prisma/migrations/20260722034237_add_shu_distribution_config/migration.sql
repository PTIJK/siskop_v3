-- CreateTable
CREATE TABLE "ShuDistributionConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jasaSimpananPercent" DECIMAL(5,2) NOT NULL,
    "jasaPinjamanPercent" DECIMAL(5,2) NOT NULL,
    "cadanganPercent" DECIMAL(5,2) NOT NULL,
    "lainnyaPercent" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShuDistributionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShuDistributionConfig_tenantId_key" ON "ShuDistributionConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "ShuDistributionConfig" ADD CONSTRAINT "ShuDistributionConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
