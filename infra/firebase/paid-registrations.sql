-- Run in Cloud SQL Studio: siskop-staging instance, postgres database.
-- Read-only: latest 200 registrations with a verified onboarding payment.
-- Current staging payments are Xendit sandbox payments.
-- The app stores paidAt as a UTC timestamp; display it in Jakarta time (WIB).
-- Xendit's Reference is CheckoutAttempt.id, not the user ID.
-- Show the latest completed attempt for each paid registration.
SELECT
  o."id" AS registration_id,
  o."adminId" AS registered_user_id,
  paid_attempt."id" AS xendit_reference,
  paid_attempt."providerSessionId" AS xendit_session_id,
  u."name" AS administrator,
  u."email",
  t."name" AS cooperative,
  t."slug" AS workspace,
  o."packageName" AS package,
  o."amount" AS amount_idr,
  o."status" AS payment_status,
  o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta' AS paid_at_wib,
  t."isActive" AS workspace_active
FROM "OnboardingOrder" AS o
JOIN "Tenant" AS t ON t."id" = o."tenantId"
LEFT JOIN "User" AS u
  ON u."id" = o."adminId" AND u."tenantId" = o."tenantId"
LEFT JOIN LATERAL (
  SELECT a."id", a."providerSessionId"
  FROM "CheckoutAttempt" AS a
  WHERE a."orderId" = o."id" AND a."status" = 'COMPLETED'
  ORDER BY a."createdAt" DESC, a."id" DESC
  LIMIT 1
) AS paid_attempt ON true
WHERE o."status" = 'PAID'
ORDER BY o."paidAt" DESC NULLS LAST, o."id" DESC
LIMIT 200;
