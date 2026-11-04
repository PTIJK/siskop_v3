-- The yearly support fee billed inside an invoice's subtotal. Referral commission
-- is not paid on it. Existing invoices default to 0 (no support portion recorded).
ALTER TABLE "Invoice" ADD COLUMN "supportAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
