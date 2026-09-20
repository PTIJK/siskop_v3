-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "unitId" TEXT;

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_unitId_idx" ON "JournalEntry"("tenantId", "unitId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: stamp every existing entry with the unit of the row that produced it,
-- so per-unit reports work on historical data too. Entries with no unit-bound
-- source (MANUAL, MEMBER_CREDIT_REPAYMENT) deliberately stay NULL — the
-- tenant-level "unallocated" bucket. Idempotent (only touches NULLs); tests/
-- journal-unit.test.ts runs exactly the statements between the markers below.
-- backfill:start
UPDATE "JournalEntry" AS je
SET "unitId" = s."unitId"
FROM "SavingTransaction" AS st
JOIN "Saving" AS s ON s."id" = st."savingId"
WHERE je."sourceType" = 'SAVING_TRANSACTION'
  AND je."sourceId" = st."id"
  AND je."tenantId" = st."tenantId"
  AND je."unitId" IS NULL;

UPDATE "JournalEntry" AS je
SET "unitId" = l."unitId"
FROM "LoanPayment" AS lp
JOIN "Loan" AS l ON l."id" = lp."loanId"
WHERE je."sourceType" = 'LOAN_PAYMENT'
  AND je."sourceId" = lp."id"
  AND je."tenantId" = lp."tenantId"
  AND je."unitId" IS NULL;

UPDATE "JournalEntry" AS je
SET "unitId" = l."unitId"
FROM "Loan" AS l
WHERE je."sourceType" = 'LOAN_DISBURSEMENT'
  AND je."sourceId" = l."id"
  AND je."tenantId" = l."tenantId"
  AND je."unitId" IS NULL;

UPDATE "JournalEntry" AS je
SET "unitId" = ps."unitId"
FROM "POSSale" AS ps
WHERE je."sourceType" = 'POS_SALE'
  AND je."sourceId" = ps."id"
  AND je."tenantId" = ps."tenantId"
  AND je."unitId" IS NULL;
-- backfill:end
