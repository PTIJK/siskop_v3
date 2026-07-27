-- DropIndex
DROP INDEX "Loan_tenantId_status_idx";

-- DropIndex
DROP INDEX "SavingsAccount_tenantId_idx";

-- DropIndex
DROP INDEX "SavingsAccount_tenantId_memberId_type_key";

-- DropIndex
DROP INDEX "Transaction_tenantId_createdAt_idx";

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "unitId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SavingsAccount" ADD COLUMN     "unitId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "unitId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "CooperativeUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CooperativeUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitMembership" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CooperativeUnit_tenantId_isActive_idx" ON "CooperativeUnit"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "CooperativeUnit_tenantId_type_idx" ON "CooperativeUnit"("tenantId", "type");

-- CreateIndex
CREATE INDEX "UnitMembership_unitId_idx" ON "UnitMembership"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitMembership_memberId_unitId_key" ON "UnitMembership"("memberId", "unitId");

-- CreateIndex
CREATE INDEX "Loan_tenantId_unitId_status_idx" ON "Loan"("tenantId", "unitId", "status");

-- CreateIndex
CREATE INDEX "SavingsAccount_tenantId_unitId_idx" ON "SavingsAccount"("tenantId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsAccount_unitId_memberId_type_key" ON "SavingsAccount"("unitId", "memberId", "type");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_unitId_createdAt_idx" ON "Transaction"("tenantId", "unitId", "createdAt");

-- AddForeignKey
ALTER TABLE "CooperativeUnit" ADD CONSTRAINT "CooperativeUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMembership" ADD CONSTRAINT "UnitMembership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitMembership" ADD CONSTRAINT "UnitMembership_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsAccount" ADD CONSTRAINT "SavingsAccount_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

