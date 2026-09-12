-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'MEMBER_CREDIT_REPAYMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MappingTransactionKind" ADD VALUE 'SALE_RECEIVABLE';
ALTER TYPE "MappingTransactionKind" ADD VALUE 'MEMBER_CREDIT_REPAYMENT';

-- CreateTable
CREATE TABLE "MemberCreditRepayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberCreditRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberCreditRepayment_tenantId_memberId_idx" ON "MemberCreditRepayment"("tenantId", "memberId");

-- AddForeignKey
ALTER TABLE "MemberCreditRepayment" ADD CONSTRAINT "MemberCreditRepayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCreditRepayment" ADD CONSTRAINT "MemberCreditRepayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCreditRepayment" ADD CONSTRAINT "MemberCreditRepayment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
