-- CreateEnum
CREATE TYPE "StallKind" AS ENUM ('KIOS', 'LOS', 'LAPAK');

-- CreateEnum
CREATE TYPE "StallStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'INACTIVE');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "commodity" TEXT;

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "block" TEXT,
    "kind" "StallKind" NOT NULL,
    "areaM2" DECIMAL(8,2),
    "status" "StallStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "Stall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Market_tenantId_idx" ON "Market"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_tenantId_name_key" ON "Market"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Stall_tenantId_marketId_block_idx" ON "Stall"("tenantId", "marketId", "block");

-- CreateIndex
CREATE UNIQUE INDEX "Stall_tenantId_marketId_code_key" ON "Stall"("tenantId", "marketId", "code");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stall" ADD CONSTRAINT "Stall_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
