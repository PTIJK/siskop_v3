-- Renewal mail progress per invoice: 0 none, 1 invoice mailed, 2 7-day reminder mailed.
ALTER TABLE "Invoice" ADD COLUMN "noticeStage" INTEGER NOT NULL DEFAULT 0;
