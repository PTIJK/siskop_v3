-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "notes" TEXT;

-- A rateNote is only legitimate on a loan whose rate was overridden away from
-- its product's rate. Anything else (e.g. bulk-import provenance text) was
-- parked there for lack of a general notes field; move it.
UPDATE "Loan" l
SET "notes" = l."rateNote",
    "rateNote" = NULL
FROM "LoanConfig" c
WHERE c."id" = l."loanConfigId"
  AND l."rateNote" IS NOT NULL
  AND (l."rate" IS NULL OR l."rate" = c."rate");
