-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- AlterTable
ALTER TABLE "SavingConfig" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubscriptionPackage" ADD COLUMN     "maxSavingConfigs" INTEGER,
ADD COLUMN     "whitelabelEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WhitelabelConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customDomain" TEXT,
    "domainStatus" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "primaryColor" TEXT,
    "hideBranding" BOOLEAN NOT NULL DEFAULT false,
    "emailSenderName" TEXT,
    "emailSenderAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhitelabelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhitelabelConfig_tenantId_key" ON "WhitelabelConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhitelabelConfig_customDomain_key" ON "WhitelabelConfig"("customDomain");

-- AddForeignKey
ALTER TABLE "WhitelabelConfig" ADD CONSTRAINT "WhitelabelConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
