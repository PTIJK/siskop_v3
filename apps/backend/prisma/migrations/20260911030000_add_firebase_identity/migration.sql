-- Existing staff hashes remain usable. Firebase accounts have no local password.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "firebaseUid" TEXT, ADD COLUMN "authProvider" TEXT;
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");
