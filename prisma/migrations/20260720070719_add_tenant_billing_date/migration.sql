-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingReminder30SentAt" TIMESTAMP(3),
ADD COLUMN     "billingReminder7SentAt" TIMESTAMP(3),
ADD COLUMN     "nextBillingDate" TIMESTAMP(3);
