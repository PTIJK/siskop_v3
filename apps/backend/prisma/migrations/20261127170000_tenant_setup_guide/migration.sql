CREATE TYPE "TenantSetupStep" AS ENUM ('CAPITAL', 'SAVINGS', 'LOANS');
ALTER TABLE "Tenant" ADD COLUMN "setupStep" "TenantSetupStep";
