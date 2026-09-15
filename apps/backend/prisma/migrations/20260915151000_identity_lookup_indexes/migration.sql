CREATE INDEX "IdentitySession_identityId_idx" ON "IdentitySession"("identityId");
CREATE INDEX "IdentitySession_expiresAt_idx" ON "IdentitySession"("expiresAt");
CREATE INDEX "IdentitySession_lastSeenAt_idx" ON "IdentitySession"("lastSeenAt");
CREATE INDEX "TenantLoginAttempt_identitySessionId_idx" ON "TenantLoginAttempt"("identitySessionId");
CREATE INDEX "TenantLoginAttempt_membershipId_idx" ON "TenantLoginAttempt"("membershipId");
CREATE INDEX "MembershipInvitation_membershipId_idx" ON "MembershipInvitation"("membershipId");
