-- Classifies every tenant's existing standard-COA equity accounts, only where still unclassified
-- and still EKUITAS. Matched on template code AND name: the same code can hold something else
-- (prisma/seed-ksu-demo.ts's 3-1000 is "Modal Kerja"), and a wrong class would silently skew
-- Modal Sendiri — anything else stays unclassified for an admin to set. Then renames the old combined
-- "Cadangan / Modal Penyertaan" account to "Cadangan Umum" where the tenant never renamed it:
-- Modal Penyertaan is not Modal Sendiri (Permenkop UKM 8/2023 Pasal 1 angka 23) and now has its
-- own account (3-5000, added by "Generate COA standar").
--
-- The old account may already hold modal penyertaan that can't be told apart from cadangan
-- here, so every tenant with a non-zero balance on it gets one bell notification asking an
-- admin to reclassify. Separate from the enum migration before it, because Postgres won't let
-- a just-added enum value be used in the same transaction. Idempotent.
-- tests/equity-class-backfill.test.ts runs exactly the statements between the markers below.
-- backfill:start
UPDATE "Account" SET "equityClass" = CASE "code"
    WHEN '3-1000' THEN 'SIMPANAN_POKOK'::"EquityClass"
    WHEN '3-1100' THEN 'SIMPANAN_WAJIB'::"EquityClass"
    WHEN '3-2000' THEN 'CADANGAN_UMUM'::"EquityClass"
    WHEN '3-3000' THEN 'SHU'::"EquityClass"
    WHEN '3-3100' THEN 'SHU'::"EquityClass"
  END
WHERE "category" = 'EKUITAS'
  AND "equityClass" IS NULL
  AND ("code", "name") IN (
    ('3-1000', 'Simpanan Pokok'),
    ('3-1100', 'Simpanan Wajib'),
    ('3-2000', 'Cadangan / Modal Penyertaan'),
    ('3-3000', 'SHU Tahun Berjalan'),
    ('3-3100', 'SHU Tahun Lalu Belum Dibagi')
  );

INSERT INTO "TenantNotification" ("id", "tenantId", "type", "title", "message", "permissionModule", "permissionAction", "relatedId", "createdAt")
SELECT
  'neqrc_' || a."id",
  a."tenantId",
  'EQUITY_RECLASS_REVIEW',
  'Tinjau akun Cadangan / Modal Penyertaan',
  'Akun 3-2000 "Cadangan / Modal Penyertaan" kini menjadi "Cadangan Umum". Modal penyertaan bukan bagian dari Modal Sendiri (Permenkop UKM 8/2023) — pindahkan saldo modal penyertaan yang tercatat di akun ini ke akun 3-5000 Modal Penyertaan melalui jurnal manual.',
  'accounting',
  'update',
  a."id",
  CURRENT_TIMESTAMP
FROM "Account" AS a
WHERE a."code" = '3-2000'
  AND a."name" = 'Cadangan / Modal Penyertaan'
  AND EXISTS (
    SELECT 1 FROM "JournalLine" AS jl
    WHERE jl."accountId" = a."id"
    GROUP BY jl."accountId"
    HAVING SUM(jl."credit") - SUM(jl."debit") <> 0
  )
  AND NOT EXISTS (SELECT 1 FROM "TenantNotification" AS n WHERE n."id" = 'neqrc_' || a."id");

UPDATE "Account" SET "name" = 'Cadangan Umum'
WHERE "code" = '3-2000' AND "name" = 'Cadangan / Modal Penyertaan';
-- backfill:end
