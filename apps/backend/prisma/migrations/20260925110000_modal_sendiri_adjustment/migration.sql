-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "auditApproachingNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ModalSendiriAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT,
    "effectiveDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModalSendiriAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModalSendiriAdjustment_tenantId_effectiveDate_idx" ON "ModalSendiriAdjustment"("tenantId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "ModalSendiriAdjustment" ADD CONSTRAINT "ModalSendiriAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModalSendiriAdjustment" ADD CONSTRAINT "ModalSendiriAdjustment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CooperativeUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Carries each tenant's hand-typed "modal disetor" into the ledger-derived Modal Sendiri as an
-- opening-balance adjustment, so the figure the tenant declared (and the BMPP / audit-threshold
-- checks built on it) doesn't drop when those checks switch to the ledger. The adjustment is the
-- part the ledger doesn't already hold: modal disetor minus Modal Sendiri currently journaled
-- (the same equity classes as MODAL_SENDIRI_CLASSES in lib/regulatory-config.ts); nothing when the
-- ledger already covers it. Tenant-level scope (unitId NULL), effective from the tenant's
-- creation so earlier year ends see it too. Idempotent via the deterministic id.
-- tests/modal-disetor-migration.test.ts runs exactly the statements between the markers below.
-- backfill:start
INSERT INTO "ModalSendiriAdjustment" ("id", "tenantId", "unitId", "effectiveDate", "amount", "reason", "createdBy", "createdAt")
SELECT
  'msadj_' || t."id",
  t."id",
  NULL,
  t."createdAt"::date,
  t."modalDisetor" - COALESCE(gl."total", 0),
  'Migrasi dari isian manual modal disetor',
  'system:migration',
  CURRENT_TIMESTAMP
FROM "Tenant" AS t
LEFT JOIN (
  SELECT a."tenantId",
    SUM(CASE WHEN a."normalBalance" = 'KREDIT' THEN jl."credit" - jl."debit" ELSE jl."debit" - jl."credit" END) AS "total"
  FROM "JournalLine" AS jl
  JOIN "Account" AS a ON a."id" = jl."accountId"
  WHERE a."equityClass" IN ('SIMPANAN_POKOK', 'SIMPANAN_WAJIB', 'MODAL_TETAP', 'CADANGAN_UMUM', 'CADANGAN_RISIKO', 'HIBAH')
  GROUP BY a."tenantId"
) AS gl ON gl."tenantId" = t."id"
WHERE t."modalDisetor" IS NOT NULL
  AND t."modalDisetor" - COALESCE(gl."total", 0) > 0
  AND NOT EXISTS (SELECT 1 FROM "ModalSendiriAdjustment" AS m WHERE m."id" = 'msadj_' || t."id");
-- backfill:end
