# Handoff — Self-Service Member Registration (QR → public form → approval queue)

Written 2026-09-15. No `HANDOFF.md` convention existed in this repo before this file — the
closest precedent was `SETUP-VERIFICATION.md`'s "Known gaps / Open decisions" structure, which
this follows.

## What was built

A teller-facing QR code that opens a public, unauthenticated registration form. A prospective
member fills in their own data; submission creates a `MemberRegistrationRequest` (PENDING) —
never a `Member` directly. A teller/admin reviews the queue and approves (creating the real
`Member`, via the same ID-generation path as manual entry) or rejects (with a required reason).

- **Data model**: `MemberRegistrationRequest` (PENDING/APPROVED/REJECTED), `Tenant.selfRegistrationEnabled`
  (default `true`), and — per the notification-scope decision below — `TenantNotification` +
  `TenantNotificationRead`, all in one migration
  (`prisma/migrations/20260915134715_add_member_registration_request`).
- **Internal endpoints** (`modules/members/registration.*`, behind the same `members.create`
  permission as manual entry): `GET self-registration-link`, `GET registration-requests`,
  `POST registration-requests/:id/approve`, `POST registration-requests/:id/reject`. `PUT
  /api/config/self-registration` toggles the flag (Super-Admin-only, matching `config.update`).
- **Public endpoint** (`modules/members/public-registration.*`, mounted at `/api/public/register`,
  no `requireAuth` anywhere in that router): `GET /:tenantSlug` (tenant branding + enabled flag),
  `POST /:tenantSlug` (the actual submission) — rate-limited (default 5/hour/IP, env-configurable),
  CAPTCHA-gated (`lib/captcha.ts`, Cloudflare Turnstile, fails closed), field-validated against the
  same Zod rules as internal member creation, KTP photo MIME-sniffed by magic bytes
  (`lib/file-sniff.ts`) rather than trusting the declared Content-Type, NIK masked to its last 4
  digits in every response, and a same-response-either-way `404` for a nonexistent or disabled
  tenant.
- **Notifications** (`modules/notifications/`, new top-level module): tenant + permission-scoped,
  polled by a bell in `Topbar.tsx`. A submission raises one with the live pending count
  ("N pendaftaran mandiri menunggu persetujuan").
- **Frontend**: "Generate QR Pendaftaran" button + modal (`qrcode.react`, new dependency) on the
  Anggota page; a "Pendaftaran Mandiri" tab with Approve/Reject and the KTP-viewed approval gate;
  a config toggle tab; the public `/daftar/:tenantSlug` route (`features/self-registration/`,
  outside `AppLayout`) with a Turnstile widget and three states (form / closed / confirmation).

## Deviations from the brief, and why

The brief was written against an idealized/older version of this codebase; the following are
corrections made against the real one, not unilateral scope changes:

1. **Module shape is the existing 3-file triad** (`routes.ts`/`schema.ts`/`service.ts`), not the
   5-file router/controller/service/schema/queries pattern the brief describes — that pattern
   doesn't exist anywhere in this codebase. Followed the real, established pattern instead.
2. **`TC-MEM-005` is not the duplicate-NIK case.** It's a positive multi-tenant-isolation test (same
   NIK across two tenants must both succeed). The actual duplicate-NIK case is `TC-MEM-004`, and it
   asserts the real `ErrorCode.NIK_EXISTS` (409) — already in `packages/types`/`lib/errors.ts`.
   Reused it rather than inventing `UNIQUE_CONSTRAINT_VIOLATION`.
3. **"Module 8 notification bell" did not exist anywhere** — no frontend component, no tenant-scoped
   route; the one `Notification`/`NotificationRead` model that existed is global/platform-admin-only
   and consumed by nothing. Per an explicit decision during planning, built a proper new
   `TenantNotification`/`TenantNotificationRead` pair (tenant + permission-scoped, generic `type`
   string so future notification types need no migration) rather than repurposing the unrelated
   platform-admin model or shipping a bare pending-count badge.
4. **`PUT`, not `PATCH`, for `/api/config/self-registration`.** Every "update a tenant setting"
   endpoint in this codebase (`modal-disetor`, `whitelabel`, `units/:id`) uses `PUT` — this would
   have been the only `PATCH` route in the system. Matched the existing convention instead.
5. **QA docs are `docs/08-QA-Test-Plan-SISKOP.md` and `docs/09-QA-Test-Cases-SISKOP.md`**, not a file
   named `QA-TEST-PLAN.md` (doesn't exist). Modules 1–15 were already assigned (8 = Config, 9 =
   Platform Admin — not what the brief assumed), and `## 16` was already the Cycle-1 execution-log
   appendix. Added the new module as `## 16. Self-Service Registration (FR-SREG)` and renumbered the
   execution log and its six subsections to `## 17`/`17.1`–`17.6`.
6. **`ENGINEER-ONBOARDING.md` does not exist**, confirmed via `SETUP-VERIFICATION.md`'s own "Known
   gaps" section (documented since the 2026-07-27 scaffold). Patterns throughout this feature were
   derived from reading the actual `members`/`config`/`onboarding` modules, not from that file.
7. **Registered both new tenant-scoped models in `lib/tenant-scope.ts`'s `TENANT_SCOPED_MODELS`
   allowlist** — a defense-in-depth Prisma guard that only covers models added to it explicitly.
   Not required by the brief, but skipping it would have left the first unauthenticated write path
   in the system without the one mechanical safety net every other tenant-scoped model gets.
8. **`.gitignore` gained an `apps/backend/uploads/` entry.** Pre-existing gap — the internal
   KTP-upload test already wrote real files there on every run with nothing ignoring them; this
   feature's own file-upload tests made the same gap harder to ignore, so it's fixed now.

## Deviations found and fixed during manual verification (Phase 5/6)

Both were caught by driving the actual pages in a real browser (headless Chrome / CDP), not by
code review alone:

- **A flexbox min-content sizing bug** on the public page: the outer `flex ... justify-center`
  wrapper couldn't shrink its child below the child's content width on some render paths. Fixed by
  switching to block layout + `mx-auto` on the card. (Chrome's `--screenshot` CLI flag turned out
  to not reliably honor `--window-size` for CSS viewport purposes in this Chrome version — the
  *real* bug, and the fix, were confirmed via `Emulation.setDeviceMetricsOverride` over the CDP,
  not the CLI screenshot flag.)
- **Duplicate confirmation text**: the success screen showed the server's `result.message` and then
  repeated the same sentence again as hardcoded copy. Replaced the second line with the actual
  masked NIK and the soft NIK-warning message, which is more useful and isn't redundant.

## Test results

Backend (`pnpm --filter @siskop/backend test`, Vitest + coverage), final clean run:
**559/559 tests passed, 51/51 test files** — coverage 95.71% lines / 85.59% branches / 94.8%
functions / 95.71% statements, all above the enforced gate (80%/70%/80%/80% per
`vitest.config.ts`). The 51 new tests for this feature: `member-registration-service` (4),
`member-registration-internal` (11), `config-self-registration` (3), `captcha` (6), `file-sniff`
(6), `member-registration-public` (16, including the tenant-isolation and rate-limit cases),
`notifications` (5). Two earlier full-suite runs during this session each showed exactly one
unrelated test (`ksu-member-statement.test.ts`, then `konsumen-sale.test.ts` — different test each
time, both pre-existing SHU/journal-posting tests unrelated to this feature) fail on a 5000ms
timeout; both reproduced only under this session's heavy concurrent load (parallel dev servers +
browser automation) and passed cleanly in isolation — not a regression from this work.

`pnpm run lint`, `pnpm run typecheck`, and `pnpm run build` are all clean (exit 0) across both
`apps/backend` and `apps/frontend`. `prisma migrate deploy` applied cleanly to both `siskop_dev`
and `siskop_test`.

Frontend has no automated test runner (`SETUP-VERIFICATION.md`'s documented, still-true gap) —
verified manually instead: QR modal (real scannable code, correct URL, copy/download/print),
Pendaftaran Mandiri tab (empty state, populated row, KTP-photo-not-attached exempts the approval
gate, Approve creates a real `Member` with the correct ID format and clears the row), the config
toggle, the notification bell (badge count, dropdown, mark-as-read), and the full public flow
end-to-end (branding fetch → form → Turnstile test-mode "Success" → submission → confirmation
screen → real DB row), plus the closed-state and not-found-state public pages. All test data
created during manual verification was deleted from `siskop_dev` afterward.

## New/modified files

**Backend** — `prisma/schema.prisma`, one migration; `src/app.ts`; `src/lib/errors.ts`,
`tenant-scope.ts`, `captcha.ts` (new), `file-sniff.ts` (new); `src/modules/members/schema.ts`
(refactored to extract `memberFieldsSchema`), `routes.ts`, `registration.{routes,schema,service}.ts`
(new), `public-registration.{routes,schema,service}.ts` (new); `src/modules/config/{routes,schema,service}.ts`;
`src/modules/notifications/{routes,service}.ts` (new module); `.env`/`.env.example` (new vars:
`TURNSTILE_SECRET_KEY`, `SELF_REGISTRATION_RATE_LIMIT_PER_HOUR`, `PUBLIC_APP_URL`); 7 new test files
plus `notifications.test.ts` updated for the `TxClient`-taking `createTenantNotification` signature.

**Frontend** — `App.tsx`, `Topbar.tsx`, `ConfigPage.tsx`, `MembersPage.tsx`; new:
`NotificationBell.tsx`, `pages/config/SelfRegistrationConfigTab.tsx`,
`pages/members/{GenerateQrModal,RegistrationRequestsTab,RejectRequestDialog}.tsx`,
`features/self-registration/{api,schema,TurnstileWidget,PublicRegistrationPage}.tsx`; `package.json`
(new dependency: `qrcode.react`); `.env.example` (`VITE_TURNSTILE_SITE_KEY`).

**Shared types** (`packages/types/src`) — `api.ts` (`CAPTCHA_FAILED` error code, `unreadCount` on
`ApiResponse.meta`), `member.ts` (registration-request + public-submission types), `tenant.ts`
(`SelfRegistrationConfig`), `notification.ts` (new).

**Docs** — `docs/08-QA-Test-Plan-SISKOP.md` (scope table, regression-checklist item),
`docs/09-QA-Test-Cases-SISKOP.md` (Module 16, Summary table, execution-log renumbered to 17),
`.gitignore`, this file.

## Three open product decisions (surfaced, not decided here)

1. **Should an approved/rejected registration notify the prospect** (SMS/WhatsApp/email), or does
   the prospect stay silent until they return to the branch? Nothing in the current build contacts
   the prospect at all — the confirmation screen just tells them to wait. No phone/email
   verification exists on the submission either, which would need resolving first if any outbound
   channel is chosen.
2. **Is Simpanan Pokok (mandatory initial deposit) collected at self-registration, or always
   in person after approval?** The current form collects no money and no savings-product selection
   — approval only creates the `Member` row, exactly as a manually-entered member with no Pokok
   saving yet. If the answer is "collect it online," that's a materially different (and
   payment-provider-involving) scope addition, not a small follow-up.
3. **Which CAPTCHA provider, and why** — decided here rather than left open, per your instruction
   during planning: **Cloudflare Turnstile**. It publishes permanent test sitekey/secret pairs that
   deterministically pass or fail server-side verification, so the entire flow — including the
   automated "missing/invalid token → 400, zero DB writes" test — is exercisable in CI/dev without
   a real account; a production site/secret key pair is a one-line env swap
   (`TURNSTILE_SECRET_KEY` / `VITE_TURNSTILE_SITE_KEY`). Revisit only if there's a reason to prefer
   hCaptcha/reCAPTCHA specifically (e.g. an existing account, a compliance requirement, a
   demonstrated Turnstile false-positive rate in production).
