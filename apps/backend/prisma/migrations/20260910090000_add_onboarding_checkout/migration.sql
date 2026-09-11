-- CreateTable
CREATE TABLE "OnboardingOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "providerSessionId" TEXT,
    "paymentUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingOrder_tenantId_key" ON "OnboardingOrder"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_providerSessionId_key" ON "CheckoutAttempt"("providerSessionId");

-- CreateIndex
CREATE INDEX "CheckoutAttempt_orderId_createdAt_idx" ON "CheckoutAttempt"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OnboardingOrder" ADD CONSTRAINT "OnboardingOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OnboardingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

