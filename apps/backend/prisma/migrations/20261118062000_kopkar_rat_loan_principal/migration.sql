ALTER TABLE "KopkarRatPublication"
  DROP CONSTRAINT "KopkarRatPublication_kind_check",
  ADD CONSTRAINT "KopkarRatPublication_kind_check"
    CHECK ("kind" IN ('member', 'saving', 'loan') OR
      ("kind" = 'loan_principal' AND "tenantId" = 'cmvpy390900018h9b1zq0c87x'));
