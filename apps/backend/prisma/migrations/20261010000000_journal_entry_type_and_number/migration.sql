-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('UMUM', 'PENYESUAIAN', 'PENUTUP');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "journalSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "JournalEntry"
  ADD COLUMN "entryType" "JournalEntryType" NOT NULL DEFAULT 'UMUM',
  ADD COLUMN "entryNo" INTEGER,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "reversalOfId" TEXT;

-- Backfill: number every existing entry per tenant in posting order, then park the
-- tenant counter at the last number handed out so new entries continue from there.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "entryDate", "createdAt", "id") AS rn
  FROM "JournalEntry"
)
UPDATE "JournalEntry" je SET "entryNo" = numbered.rn FROM numbered WHERE je."id" = numbered."id";

UPDATE "Tenant" t SET "journalSeq" = COALESCE((SELECT MAX("entryNo") FROM "JournalEntry" je WHERE je."tenantId" = t."id"), 0);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_entryNo_key" ON "JournalEntry"("tenantId", "entryNo");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_entryType_entryDate_idx" ON "JournalEntry"("tenantId", "entryType", "entryDate");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
