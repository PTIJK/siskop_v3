-- Restocks recorded before restocking was journaled have no JournalEntry at all, so they
-- never reached Persediaan (which then only ever got credited by HPP and went negative).
--
-- Create a PLACEHOLDER per such movement: status UNPOSTED_MISSING_MAPPING and no lines, so it
-- has NO effect on any report until an admin deliberately runs "Posting sekarang" (which
-- rebuilds it from the movement and the tenant's STOCK_PURCHASE mapping). Deliberately not
-- posted here: a koperasi that already booked its restocks as manual journal entries would
-- otherwise have them counted twice.
--
-- Only costed restocks (`IN`, quantity and product cost > 0): an ADJUSTMENT sets the count and
-- its delta isn't stored, and a zero-cost restock has nothing to post. Idempotent (skips any
-- movement that already has an entry) and separate from the enum migration before it, because
-- Postgres won't let a just-added enum value be used in the same transaction.
-- tests/stock-journal.test.ts runs exactly the statements between the markers below.
-- backfill:start
INSERT INTO "JournalEntry" ("id", "tenantId", "unitId", "entryDate", "sourceType", "sourceId", "description", "status", "createdAt")
SELECT
  'jstk_' || sm."id",
  sm."tenantId",
  sm."unitId",
  sm."createdAt",
  'STOCK_MOVEMENT'::"JournalSourceType",
  sm."id",
  'Restok stok (dicatat ulang)',
  'UNPOSTED_MISSING_MAPPING'::"JournalEntryStatus",
  CURRENT_TIMESTAMP
FROM "StockMovement" AS sm
JOIN "Product" AS p ON p."id" = sm."productId"
WHERE sm."type" = 'IN'
  AND sm."quantity" > 0
  AND p."cost" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "JournalEntry" AS je
    WHERE je."sourceType" = 'STOCK_MOVEMENT' AND je."sourceId" = sm."id"
  );
-- backfill:end
