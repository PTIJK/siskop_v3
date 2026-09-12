CREATE TABLE "RegistrationEmail" (
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "details" JSONB NOT NULL,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "resendId" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationEmail_pkey" PRIMARY KEY ("orderId")
);
CREATE INDEX "RegistrationEmail_status_createdAt_idx" ON "RegistrationEmail"("status", "createdAt");
ALTER TABLE "RegistrationEmail" ADD CONSTRAINT "RegistrationEmail_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "OnboardingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
