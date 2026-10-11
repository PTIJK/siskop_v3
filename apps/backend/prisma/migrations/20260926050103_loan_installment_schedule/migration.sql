-- CreateEnum
CREATE TYPE "InstallmentFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "installmentAmount" DECIMAL(15,2),
ADD COLUMN     "installmentCount" INTEGER,
ADD COLUMN     "installmentFrequency" "InstallmentFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "maturityDate" DATE,
ADD COLUMN     "rate" DECIMAL(8,4),
ADD COLUMN     "rateNote" TEXT;

-- AlterTable
ALTER TABLE "LoanConfig" ADD COLUMN     "installmentFrequency" "InstallmentFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "maxInstallments" INTEGER;

-- AlterTable
ALTER TABLE "LoanPayment" ALTER COLUMN "dueDate" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalDue" DECIMAL(15,2) NOT NULL,
    "interestDue" DECIMAL(15,2) NOT NULL,
    "principalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'UNPAID',
    "paidOffAt" TIMESTAMP(3),

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "interest" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "LoanPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanInstallment_tenantId_dueDate_status_idx" ON "LoanInstallment"("tenantId", "dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_loanId_seq_key" ON "LoanInstallment"("loanId", "seq");

-- CreateIndex
CREATE INDEX "LoanPaymentAllocation_paymentId_idx" ON "LoanPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "LoanPaymentAllocation_installmentId_idx" ON "LoanPaymentAllocation"("installmentId");

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPaymentAllocation" ADD CONSTRAINT "LoanPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "LoanPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPaymentAllocation" ADD CONSTRAINT "LoanPaymentAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "LoanInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
