-- CreateEnum
CREATE TYPE "CollectionBatchStatus" AS ENUM ('OPEN', 'SUBMITTED', 'VERIFIED');

-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'COLLECTION_BATCH';

-- AlterEnum
ALTER TYPE "MappingTransactionKind" ADD VALUE 'COLLECTOR_CASH';

-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "collectionBatchId" TEXT;

-- AlterTable
ALTER TABLE "SavingTransaction" ADD COLUMN     "collectionBatchId" TEXT;

-- CreateTable
CREATE TABLE "CollectorAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "CollectionBatchStatus" NOT NULL DEFAULT 'OPEN',
    "expectedTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivedTotal" DECIMAL(15,2),
    "variance" DECIMAL(15,2),
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectorAssignment_tenantId_userId_idx" ON "CollectorAssignment"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorAssignment_tenantId_memberId_key" ON "CollectorAssignment"("tenantId", "memberId");

-- CreateIndex
CREATE INDEX "CollectionBatch_tenantId_status_idx" ON "CollectionBatch"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionBatch_tenantId_collectorId_businessDate_key" ON "CollectionBatch"("tenantId", "collectorId", "businessDate");

-- AddForeignKey
ALTER TABLE "SavingTransaction" ADD CONSTRAINT "SavingTransaction_collectionBatchId_fkey" FOREIGN KEY ("collectionBatchId") REFERENCES "CollectionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_collectionBatchId_fkey" FOREIGN KEY ("collectionBatchId") REFERENCES "CollectionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorAssignment" ADD CONSTRAINT "CollectorAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorAssignment" ADD CONSTRAINT "CollectorAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorAssignment" ADD CONSTRAINT "CollectorAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionBatch" ADD CONSTRAINT "CollectionBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionBatch" ADD CONSTRAINT "CollectionBatch_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
