-- AlterTable
ALTER TABLE "User" ADD COLUMN     "identityId" TEXT;

-- CreateTable
CREATE TABLE "AccountIdentity" (
    "id" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentitySession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "authTime" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantLoginAttempt" (
    "id" TEXT NOT NULL,
    "identitySessionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "bindingHash" TEXT,
    "stateHash" TEXT,
    "challenge" TEXT,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "TenantLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipInvitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountIdentity_firebaseUid_key" ON "AccountIdentity"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "IdentitySession_tokenHash_key" ON "IdentitySession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLoginAttempt_codeHash_key" ON "TenantLoginAttempt"("codeHash");

-- CreateIndex
CREATE INDEX "TenantLoginAttempt_expiresAt_idx" ON "TenantLoginAttempt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipInvitation_tokenHash_key" ON "MembershipInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_identityId_tenantId_key" ON "User"("identityId", "tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "AccountIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentitySession" ADD CONSTRAINT "IdentitySession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "AccountIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLoginAttempt" ADD CONSTRAINT "TenantLoginAttempt_identitySessionId_fkey" FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLoginAttempt" ADD CONSTRAINT "TenantLoginAttempt_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipInvitation" ADD CONSTRAINT "MembershipInvitation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep all existing staff IDs and transaction references. Only proven UID bindings
-- are migrated; email coincidence is never an identity-linking mechanism.
INSERT INTO "AccountIdentity" ("id", "firebaseUid")
SELECT 'identity-' || "id", "firebaseUid" FROM "User" WHERE "firebaseUid" IS NOT NULL;
UPDATE "User" u SET "identityId" = i."id" FROM "AccountIdentity" i WHERE i."firebaseUid" = u."firebaseUid";

-- Compatibility for all existing onboarding/provisioning writers during rollout.
CREATE FUNCTION link_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."firebaseUid" IS NOT NULL THEN
    INSERT INTO "AccountIdentity" ("id", "firebaseUid") VALUES ('identity-' || NEW."id", NEW."firebaseUid")
      ON CONFLICT ("firebaseUid") DO NOTHING;
    SELECT "id" INTO NEW."identityId" FROM "AccountIdentity" WHERE "firebaseUid" = NEW."firebaseUid";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_identity_link BEFORE INSERT OR UPDATE OF "firebaseUid" ON "User"
FOR EACH ROW EXECUTE FUNCTION link_user_identity();
