ALTER TABLE "SubscriptionPackage" ADD COLUMN "customSubdomainEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "slugLastChangedAt" TIMESTAMP(3);
CREATE TABLE "TenantSlugReservation" (
  "slug" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TenantSlugReservation_tenantId_idx" ON "TenantSlugReservation"("tenantId");
CREATE TABLE "TenantSlugChange" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "oldSlug" TEXT NOT NULL,
  "newSlug" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TenantSlugChange_tenantId_createdAt_idx" ON "TenantSlugChange"("tenantId", "createdAt");
INSERT INTO "TenantSlugReservation" ("slug", "tenantId") SELECT "slug", "id" FROM "Tenant";
