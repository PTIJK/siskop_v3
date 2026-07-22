-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AUDIT_THRESHOLD_EXCEEDED';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "auditThresholdNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "modalDisetor" DECIMAL(15,2);
