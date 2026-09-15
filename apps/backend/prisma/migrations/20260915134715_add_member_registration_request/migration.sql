-- CreateEnum
CREATE TYPE "MemberRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "selfRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MemberRegistrationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nik" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "birthPlace" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "occupation" TEXT NOT NULL,
    "phone" TEXT,
    "ktpPhotoUrl" TEXT,
    "status" "MemberRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdMemberId" TEXT,

    CONSTRAINT "MemberRegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "permissionModule" TEXT NOT NULL,
    "permissionAction" TEXT NOT NULL,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantNotificationRead" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantNotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberRegistrationRequest_createdMemberId_key" ON "MemberRegistrationRequest"("createdMemberId");

-- CreateIndex
CREATE INDEX "MemberRegistrationRequest_tenantId_status_idx" ON "MemberRegistrationRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MemberRegistrationRequest_tenantId_nik_idx" ON "MemberRegistrationRequest"("tenantId", "nik");

-- CreateIndex
CREATE INDEX "TenantNotification_tenantId_createdAt_idx" ON "TenantNotification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantNotificationRead_userId_idx" ON "TenantNotificationRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantNotificationRead_notificationId_userId_key" ON "TenantNotificationRead"("notificationId", "userId");

-- AddForeignKey
ALTER TABLE "MemberRegistrationRequest" ADD CONSTRAINT "MemberRegistrationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRegistrationRequest" ADD CONSTRAINT "MemberRegistrationRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRegistrationRequest" ADD CONSTRAINT "MemberRegistrationRequest_createdMemberId_fkey" FOREIGN KEY ("createdMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantNotification" ADD CONSTRAINT "TenantNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantNotificationRead" ADD CONSTRAINT "TenantNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "TenantNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantNotificationRead" ADD CONSTRAINT "TenantNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
