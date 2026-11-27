-- Run with psql -v ON_ERROR_STOP=1 after deploying POKOK_WAJIB, during a savings write pause.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "SavingConfig", "Saving", "SavingTransaction", "AccountMapping", "Account"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  tenant_id text;
  pokok_id text;
  wajib_id text;
BEGIN
  SELECT id INTO STRICT tenant_id FROM "Tenant"
    WHERE slug = 'koperasi-universitas-muhammadiyah-fbe31f83bda9';
  SELECT id INTO STRICT pokok_id FROM "SavingConfig"
    WHERE "tenantId" = tenant_id AND type = 'POKOK' AND "isActive" AND rate = 0;
  SELECT id INTO STRICT wajib_id FROM "SavingConfig"
    WHERE "tenantId" = tenant_id AND type = 'WAJIB' AND "isActive" AND rate = 0;

  IF EXISTS (SELECT 1 FROM "SavingConfig" WHERE "tenantId" = tenant_id AND type = 'POKOK_WAJIB')
    OR NOT EXISTS (
      SELECT 1 FROM "AccountMapping" d
      JOIN "AccountMapping" w ON w."tenantId" = d."tenantId" AND w."sourceId" = d."sourceId"
        AND w."sourceType" = 'SAVING_CONFIG' AND w."transactionKind" = 'WITHDRAWAL'
      JOIN "Account" a ON a.id = d."creditAccountId" AND a."tenantId" = tenant_id
      WHERE d."tenantId" = tenant_id AND d."sourceId" = pokok_id
        AND d."sourceType" = 'SAVING_CONFIG' AND d."transactionKind" = 'DEPOSIT'
        AND a.category = 'EKUITAS' AND a."isActive" AND NOT a."isHeader"
        AND w."debitAccountId" = d."creditAccountId"
        AND w."creditAccountId" = d."debitAccountId"
    ) THEN
    RAISE EXCEPTION 'Unexpected combined configuration or missing Pokok equity mapping';
  END IF;

  CREATE TEMP TABLE kopkar_pairs ON COMMIT DROP AS
    SELECT p.id AS pokok, w.id AS wajib, p.balance AS pokok_balance, w.balance AS wajib_balance
    FROM "Saving" p JOIN "Saving" w USING ("tenantId", "memberId", "unitId")
    WHERE p."tenantId" = tenant_id AND p."savingConfigId" = pokok_id AND w."savingConfigId" = wajib_id
      AND p."isActive" AND w."isActive";

  IF (SELECT count(*) FROM "Saving" WHERE "savingConfigId" IN (pokok_id, wajib_id)) <> 518
    OR NOT EXISTS (
      SELECT 1 FROM kopkar_pairs
      HAVING count(*) = 259 AND count(DISTINCT pokok) = 259 AND count(DISTINCT wajib) = 259
        AND sum(pokok_balance + wajib_balance) = 1027813000
        AND bool_and(pokok_balance >= 0 AND wajib_balance >= 0
          AND abs(pokok_balance - (pokok_balance + wajib_balance) * 0.70) <= 1)
    ) THEN
    RAISE EXCEPTION 'Muhammadiyah savings differ from the expected 259 pairs, total, or 70/30 split';
  END IF;

  -- Keep transaction IDs so journal references and collection history still resolve.
  UPDATE "SavingTransaction" t SET "savingId" = p.pokok
    FROM kopkar_pairs p WHERE t."savingId" = p.wajib;
  UPDATE "Saving" s SET balance = p.pokok_balance + p.wajib_balance, "updatedAt" = now()
    FROM kopkar_pairs p WHERE s.id = p.pokok;
  UPDATE "Saving" s SET balance = 0, "isActive" = false, "updatedAt" = now()
    FROM kopkar_pairs p WHERE s.id = p.wajib;
  UPDATE "SavingConfig" SET "isActive" = false, "isDefault" = false WHERE id = wajib_id;
  UPDATE "SavingConfig" SET type = 'POKOK_WAJIB', name = 'Simpanan Pokok + Wajib' WHERE id = pokok_id;
END $$;

COMMIT;
