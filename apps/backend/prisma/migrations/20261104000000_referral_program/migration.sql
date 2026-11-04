-- CreateEnum
CREATE TYPE "ReferralPartnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReferralPartnerSource" AS ENUM ('APPLICATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "TenantReferralSource" AS ENUM ('REGISTRATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReferralCommissionStatus" AS ENUM ('ACCRUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "ReferralPayoutStatus" AS ENUM ('DRAFT', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "PricingSetting" ADD COLUMN     "referralDefaultMonths" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "referralDefaultRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2;

-- CreateTable
CREATE TABLE "ReferralPartner" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "ktpNo" TEXT NOT NULL,
    "npwp" TEXT,
    "bankName" TEXT NOT NULL,
    "bankAccountNo" TEXT NOT NULL,
    "bankAccountName" TEXT NOT NULL,
    "salesPlan" TEXT,
    "termsVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "commissionMonths" INTEGER NOT NULL,
    "status" "ReferralPartnerStatus" NOT NULL,
    "source" "ReferralPartnerSource" NOT NULL,
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantReferral" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "codeUsed" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "months" INTEGER NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "source" "TenantReferralSource" NOT NULL,
    "flaggedSelfReferral" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCommission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "baseAmount" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "ReferralCommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "voidReason" TEXT,
    "payoutId" TEXT,
    "accruedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(15,2) NOT NULL,
    "taxWithheld" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(15,2) NOT NULL,
    "status" "ReferralPayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "transferRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPartner_code_key" ON "ReferralPartner"("code");

-- CreateIndex
CREATE INDEX "ReferralPartner_status_idx" ON "ReferralPartner"("status");

-- CreateIndex
CREATE INDEX "ReferralPartner_email_idx" ON "ReferralPartner"("email");

-- CreateIndex
CREATE INDEX "ReferralPartner_phone_idx" ON "ReferralPartner"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "TenantReferral_tenantId_key" ON "TenantReferral"("tenantId");

-- CreateIndex
CREATE INDEX "TenantReferral_partnerId_idx" ON "TenantReferral"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCommission_invoiceId_key" ON "ReferralCommission"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCommission_paymentId_key" ON "ReferralCommission"("paymentId");

-- CreateIndex
CREATE INDEX "ReferralCommission_partnerId_status_idx" ON "ReferralCommission"("partnerId", "status");

-- CreateIndex
CREATE INDEX "ReferralCommission_tenantId_idx" ON "ReferralCommission"("tenantId");

-- CreateIndex
CREATE INDEX "ReferralCommission_payoutId_idx" ON "ReferralCommission"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_number_key" ON "ReferralPayout"("number");

-- CreateIndex
CREATE INDEX "ReferralPayout_partnerId_status_idx" ON "ReferralPayout"("partnerId", "status");

-- AddForeignKey
ALTER TABLE "TenantReferral" ADD CONSTRAINT "TenantReferral_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantReferral" ADD CONSTRAINT "TenantReferral_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "TenantReferral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ReferralPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

