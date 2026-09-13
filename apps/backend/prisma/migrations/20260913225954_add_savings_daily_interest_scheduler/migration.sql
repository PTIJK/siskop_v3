-- AlterEnum
ALTER TYPE "MappingTransactionKind" ADD VALUE 'SAVING_INTEREST';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'INTEREST';

-- DropForeignKey
ALTER TABLE "SavingTransaction" DROP CONSTRAINT "SavingTransaction_createdBy_fkey";

-- AlterTable
ALTER TABLE "Saving" ADD COLUMN     "lastInterestAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SavingTransaction" ALTER COLUMN "createdBy" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SavingTransaction" ADD CONSTRAINT "SavingTransaction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
