ALTER TABLE "Member"
  ALTER COLUMN "nik" DROP NOT NULL,
  ALTER COLUMN "birthDate" DROP NOT NULL,
  ADD COLUMN "identityUnverified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD CONSTRAINT "Member_kopkar_tmp_incomplete_identity"
  CHECK (("nik" IS NOT NULL AND "birthDate" IS NOT NULL AND NOT "identityUnverified") OR
    ("tenantId" = 'cmvpy390900018h9b1zq0c87x' AND "memberId" LIKE 'TMP-%' AND "identityUnverified"));
