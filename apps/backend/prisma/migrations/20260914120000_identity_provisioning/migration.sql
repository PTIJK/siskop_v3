CREATE TABLE "IdentityProvisioning" (
  "uid" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "IdentityProvisioning_status_createdAt_idx" ON "IdentityProvisioning"("status", "createdAt");
