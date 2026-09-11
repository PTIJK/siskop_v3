-- Read-only payment-to-registration lookup.
-- Replace the value below with Xendit's Reference or Payment Session ID.
-- The example is from LOCAL preview; run against that database for this record.
-- Cloud SQL contains only registrations made on the Firebase staging site.
WITH lookup AS (
  SELECT 'cmtvn3lid000ia0ugcks5ipac'::text AS value
)
SELECT
  a."id" AS xendit_reference,
  a."providerSessionId" AS xendit_session_id,
  a."status" AS checkout_status,
  o."id" AS registration_id,
  o."adminId" AS registered_user_id,
  u."name" AS registered_administrator,
  u."email",
  t."name" AS cooperative,
  t."slug" AS workspace,
  o."packageName" AS package,
  o."amount" AS amount_idr,
  o."status" AS registration_payment_status,
  o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta' AS verified_at_wib
FROM "CheckoutAttempt" AS a
JOIN "OnboardingOrder" AS o ON o."id" = a."orderId"
JOIN "Tenant" AS t ON t."id" = o."tenantId"
LEFT JOIN "User" AS u ON u."id" = o."adminId" AND u."tenantId" = o."tenantId"
CROSS JOIN lookup
WHERE a."id" = lookup.value OR a."providerSessionId" = lookup.value
ORDER BY a."createdAt" DESC;
