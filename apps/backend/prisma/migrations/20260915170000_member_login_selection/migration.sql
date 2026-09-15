-- CreateTable
CREATE TABLE "MemberLoginSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberLoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberLoginGrant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "credentialVersion" TEXT NOT NULL,

    CONSTRAINT "MemberLoginGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberLoginAttempt" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "bindingHash" TEXT,
    "stateHash" TEXT,
    "challenge" TEXT,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "MemberLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberLoginSession_tokenHash_key" ON "MemberLoginSession"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberLoginSession_expiresAt_idx" ON "MemberLoginSession"("expiresAt");

-- CreateIndex
CREATE INDEX "MemberLoginGrant_memberId_idx" ON "MemberLoginGrant"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLoginGrant_sessionId_memberId_key" ON "MemberLoginGrant"("sessionId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLoginAttempt_codeHash_key" ON "MemberLoginAttempt"("codeHash");

-- CreateIndex
CREATE INDEX "MemberLoginAttempt_grantId_idx" ON "MemberLoginAttempt"("grantId");

-- CreateIndex
CREATE INDEX "MemberLoginAttempt_expiresAt_idx" ON "MemberLoginAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "Member_nik_idx" ON "Member"("nik");

-- AddForeignKey
ALTER TABLE "MemberLoginGrant" ADD CONSTRAINT "MemberLoginGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MemberLoginSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberLoginGrant" ADD CONSTRAINT "MemberLoginGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberLoginAttempt" ADD CONSTRAINT "MemberLoginAttempt_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "MemberLoginGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

