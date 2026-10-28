-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionCreatedVia" AS ENUM ('REGISTRATION', 'ADMIN', 'MIGRATION');

-- CreateEnum
CREATE TYPE "VolumeItem" AS ENUM ('MEMBERS', 'USERS', 'SAVING_TYPES', 'LOAN_TYPES');

-- CreateEnum
CREATE TYPE "AddonPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('REGISTRATION', 'RENEWAL', 'ADDON', 'SUPPORT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'EXPIRED', 'VOID');

-- AlterTable
ALTER TABLE "SubscriptionPackage" ADD COLUMN     "code" TEXT,
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxLoanTypes" INTEGER,
ADD COLUMN     "maxSavingTypes" INTEGER,
ADD COLUMN     "priceMonthly" DECIMAL(15,2),
ADD COLUMN     "priceYearly" DECIMAL(15,2),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "maxUsers" DROP NOT NULL,
ALTER COLUMN "maxMembers" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "requires" TEXT[],
    "customPrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "priceGroup" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeAddon" (
    "id" TEXT NOT NULL,
    "itemKey" "VolumeItem" NOT NULL,
    "stepQty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "period" "AddonPeriod" NOT NULL DEFAULT 'YEARLY',

    CONSTRAINT "VolumeAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearlyCost" DECIMAL(15,2) NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "onsite" BOOLEAN NOT NULL DEFAULT false,
    "visitsPerYear" INTEGER NOT NULL DEFAULT 0,
    "slaHours" INTEGER,
    "aiSupport" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupportPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "yearlyMultiplier" INTEGER NOT NULL DEFAULT 10,
    "enabledCycles" "BillingCycle"[],
    "defaultPackageCode" TEXT NOT NULL,
    "customEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customBaseLimits" JSONB NOT NULL,
    "addonsOnFixedPackages" BOOLEAN NOT NULL DEFAULT true,
    "paymentGraceDays" INTEGER NOT NULL DEFAULT 7,
    "unpaidRegistrationPurgeDays" INTEGER NOT NULL DEFAULT 14,
    "taxRate" DECIMAL(6,4),
    "invoiceNumberFormat" TEXT NOT NULL DEFAULT 'INV-YYYYMM-NNNN',
    "paymentProvider" TEXT NOT NULL DEFAULT 'manual',
    "paymentInstructions" TEXT,
    "oneFreeTenantPerRegistrationNo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "pricingVersion" INTEGER NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "supportPlanId" TEXT,
    "selectedFeatureKeys" TEXT[],
    "addons" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB NOT NULL,
    "amountPerCycle" DECIMAL(15,2) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "nextBillingDate" TIMESTAMP(3),
    "createdVia" "SubscriptionCreatedVia" NOT NULL,
    "limitOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "credentials" JSONB,
    "enabledMethods" TEXT[],
    "webhookSecret" TEXT,
    "invoiceExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(6,4),
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "gatewayRef" TEXT,
    "paymentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gatewayTxnId" TEXT,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PackageFeature_packageId_featureId_key" ON "PackageFeature"("packageId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeAddon_itemKey_key" ON "VolumeAddon"("itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupportPlan_code_key" ON "SupportPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PricingVersion_version_key" ON "PricingVersion"("version");

-- CreateIndex
CREATE INDEX "PricingAuditLog_entity_at_idx" ON "PricingAuditLog"("entity", "at");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSubscription_packageId_idx" ON "TenantSubscription"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayConfig_provider_key" ON "PaymentGatewayConfig"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPackage_code_key" ON "SubscriptionPackage"("code");

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Feature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_supportPlanId_fkey" FOREIGN KEY ("supportPlanId") REFERENCES "SupportPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

