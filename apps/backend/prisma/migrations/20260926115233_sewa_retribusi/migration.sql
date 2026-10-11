-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('SEWA', 'RETRIBUSI');

-- CreateEnum
CREATE TYPE "ChargePeriod" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSourceType" ADD VALUE 'CHARGE_ACCRUAL';
ALTER TYPE "JournalSourceType" ADD VALUE 'CHARGE_PAYMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MappingTransactionKind" ADD VALUE 'CHARGE_ACCRUAL_SEWA';
ALTER TYPE "MappingTransactionKind" ADD VALUE 'CHARGE_ACCRUAL_RETRIBUSI';
ALTER TYPE "MappingTransactionKind" ADD VALUE 'CHARGE_PAYMENT';

-- CreateTable
CREATE TABLE "StallContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stallId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "rentAmount" DECIMAL(15,2) NOT NULL,
    "rentPeriod" "ChargePeriod" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StallContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevyRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "stallKind" "StallKind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "period" "ChargePeriod" NOT NULL DEFAULT 'DAILY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "stallId" TEXT NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'UNPAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "collectionBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StallContract_tenantId_stallId_isActive_idx" ON "StallContract"("tenantId", "stallId", "isActive");

-- CreateIndex
CREATE INDEX "LevyRate_tenantId_marketId_stallKind_idx" ON "LevyRate"("tenantId", "marketId", "stallKind");

-- CreateIndex
CREATE INDEX "Charge_tenantId_memberId_status_idx" ON "Charge"("tenantId", "memberId", "status");

-- CreateIndex
CREATE INDEX "Charge_tenantId_stallId_idx" ON "Charge"("tenantId", "stallId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_sourceId_periodStart_key" ON "Charge"("sourceId", "periodStart");

-- CreateIndex
CREATE INDEX "ChargePayment_chargeId_idx" ON "ChargePayment"("chargeId");

-- CreateIndex
CREATE INDEX "ChargePayment_tenantId_idx" ON "ChargePayment"("tenantId");

-- AddForeignKey
ALTER TABLE "StallContract" ADD CONSTRAINT "StallContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallContract" ADD CONSTRAINT "StallContract_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StallContract" ADD CONSTRAINT "StallContract_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevyRate" ADD CONSTRAINT "LevyRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevyRate" ADD CONSTRAINT "LevyRate_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "Stall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePayment" ADD CONSTRAINT "ChargePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePayment" ADD CONSTRAINT "ChargePayment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePayment" ADD CONSTRAINT "ChargePayment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePayment" ADD CONSTRAINT "ChargePayment_collectionBatchId_fkey" FOREIGN KEY ("collectionBatchId") REFERENCES "CollectionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
