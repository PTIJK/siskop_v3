# Tenant selection and canonical dashboard login

Status: implemented on `feature/member-login`; coordinated staging rollout and hosted staff E2E remain pending.
Date: 2026-09-15.

## Implementation and verification (2026-09-15)

Implemented the identity/membership migration, verified invitation linking, paginated membership discovery, central login modal, single-tenant redirect, browser-bound code handoff, generic staff-route guards, and the dashboard switcher. Existing staff IDs, role IDs, unit assignments, and transaction references remain in place. Legacy staff continue to use their koperasi's `/login/legacy`.

Member entry is separate: `/anggota/login` serves the packaged mobile member application on central Hosting and the tenant gateway. On a generic hostname it asks for the koperasi address; on a tenant hostname it resolves the workspace through `/api/workspace` and accepts NIK/password. Member deep links and the forced password-change page bootstrap their own session.

Local browser checks with isolated Firebase Auth/Postgres fixtures passed:

- Central single-membership login -> Alpha `/dashboard`, Super Admin, one synthetic member.
- Central multi-membership login -> modal showing Alpha/Teller and Beta/Super Admin -> Beta dashboard with zero members.
- Dashboard picker cancellation stays on the current page; Alpha <-> Beta switching changes hostname, data and role.
- Staff refresh after reload; logout returns to central login, preserves independent existing Beta/member sessions, and requires reauthentication before another switch.
- Reauthentication resumes the selected membership, including existing UUID staff IDs.
- Member NIK/password -> `/anggota/dashboard`; savings navigation and reload retain the member session. Generic `/anggota/login` displays the koperasi-address form.

All 527 backend tests, 64 release tests and seven gateway/scheduler transport tests passed after rebasing onto current `main`. A rollback-only SQL smoke test also verified that backfill preserves an existing staff ID and historical actor reference, and leaves an unrelated legacy account with the same email unlinked.

Automated tests cover invitations, unauthorized memberships, wrong tenant/browser/state/verifier, expiry, replay and concurrent redemption, inactive/no-access states, role/unit scopes, pagination, direct login, platform login, cookie transport, and existing member authentication. Production builds, type checking, lint and the release/gateway tests pass. Release checks now require the member HTML to reference `/member-app/assets/`, so a successful staff-SPA fallback cannot hide a broken member route.

The requested existing PTAP member was activated only while its portal password was unset. Its staging member login and profile API checks returned 200, with first-login password change required. No real staff identity received an extra membership. The new routing and staff selector have **not** been deployed; local emulator/browser results do not prove hosted Google login or HTTPS handoffs.

### Run the local E2E fixture

Use the isolated Postgres setup in [tenant-domains.md](tenant-domains.md), then:

```sh
pnpm --filter @siskop/backend db:generate
pnpm --filter @siskop/types build
pnpm --filter @siskop/mobile exec vite build
node infra/tenant-web/package-member-app.mjs
# Run these in separate terminals:
firebase emulators:start --only auth --project demo-siskop-tenants --config infra/tenant-web/emulators.json
bash infra/tenant-web/preview-api.sh
node infra/tenant-web/preview.mjs
```

Central login: `http://localhost:3050/login`. Single-tenant account: `alpha@tenant-preview.test`. Multi-tenant account: `beta@tenant-preview.test`. Both use the isolated fixture password `Preview-only-123`.

Member preview: `http://alpha-preview.koperasi.localhost:3050/anggota/login`, fixture NIK `1234556787654321`, password `Member-preview-123`. These preview credentials do not apply to staging.

### Release controls

- Runtime flags: `TENANT_LOGIN_SELECTION_ENABLED` and `TENANT_SWITCHING_ENABLED`, both default off.
- Cloud Build substitutions: `_TENANT_HOSTING=true`, `_TENANT_LOGIN_SELECTION_ENABLED=true`, `_TENANT_SWITCHING_ENABLED=true`. Selection refuses deployment without coordinated tenant hosting.
- First deploy the compatible schema/API/web revision with selection off, then enable selection/switching in a coordinated release. All revisions and recovery jobs must understand linked identities before invitations are used.
- Apply both additive migrations before serving the new API. Never run database-clearing test suites against staging.
- Release publishing accepts only current `main`; the feature branch is for review. Hosted synthetic single/multi-account and real Google/password E2E checks remain a rollout gate.
- Ordinary logout ends current staff and central identity cookies; other already-open tenant sessions remain independent. This is not a sign-out-everywhere implementation.

The sections below retain the approved design and acceptance criteria.

## 1. Required behavior

After a staff user authenticates at the central login, count their eligible koperasi memberships:

| Memberships | Result |
| --- | --- |
| One | Automatically establish a session on that koperasi's canonical domain and open `/dashboard`. |
| Multiple | Display a **Pilih Koperasi** modal. Selecting a koperasi establishes a session on its canonical domain and opens `/dashboard`. |
| None | Show an access-unavailable screen with sign-out and assistance actions; issue no tenant business session. |

Example destination: `https://ptap.koperasi.inovasijayakarsa.id/dashboard`.
The central hostname must not remain the address of a successful staff dashboard.
Optional phase: allow an authenticated user to open the same selector from the dashboard and switch koperasi.

This plan covers staff and koperasi administrators. Platform administrators retain their central administration flow. Member NIK/password login remains a separate audience. Reseller domains are a future extension of canonical-domain resolution, not a prerequisite for this release.

## 2. Current implementation and gaps

- `apps/frontend/src/features/onboarding/pages/AuthPage.tsx` stores the returned session and calls `navigate('/dashboard')`, preserving the current hostname.
- `apps/backend/src/modules/onboarding/service.ts` resolves one `User` by unique `firebaseUid` and immediately issues that user's tenant session.
- `User.tenantId` and `User.roleId` belong to one koperasi. Transactions and unit assignments reference the existing `User.id`.
- Tenant-domain middleware already verifies signed gateway context and rejects a session belonging to a different tenant.
- `tenantLoginUrl()` and the frontend canonical URL validator already provide the existing namespace boundary.
- Staff refresh cookies are host-only. Firebase Hosting's cookie adapter must be respected when adding authentication-flow cookies.
- Identity creation/reconciliation currently assumes one Firebase UID corresponds to one `User`. It must change with the data model.
- Legacy password staff accounts are identified inside a tenant; their emails are not globally unique identities.

## 3. Data model: preserve existing staff IDs

Add `AccountIdentity` as the global, authenticated person:

- `id`, unique `firebaseUid`, identity-level active/disabled state, creation/update timestamps.
- Identity-provider email and provider metadata, if cached, are descriptive; authorization uses the verified UID.

Add nullable `User.identityId` referencing `AccountIdentity`. Existing `User` rows become the tenant memberships:

- Keep `id`, `tenantId`, `roleId`, tenant profile, active status, and unit assignments.
- Add a unique constraint on `(identityId, tenantId)` for linked identities.
- A single identity can therefore have different roles in multiple koperasi.
- Keep historical transaction references attached to the same `User.id`.
- Keep legacy password accounts unlinked until a verified linking or migration workflow completes.

Do not merge accounts merely because their email strings match. Backfill only existing verified Firebase UID bindings.

### Making multiple memberships possible

Provide a tenant-admin invitation/linking workflow as part of the core release:

1. An administrator with user-management permission assigns the role and unit scope within their own koperasi.
2. Create an expiring, single-use invitation for that tenant membership.
3. The recipient authenticates and proves control of the intended verified account before accepting.
4. Acceptance links that identity to the membership; enforce tenant/identity uniqueness and prevent role escalation.
5. Existing Firebase accounts use invitation acceptance instead of attempting to create another Firebase user with the same email.

Adapt staff creation, platform provisioning, onboarding, profile updates, and the identity recovery ledger. Recovery must treat an identity linked to any membership as in use and must never delete it because one tenant membership was removed. Invitation acceptance must be implemented and tested before multi-membership login is considered deliverable.

## 4. Identity login and eligible memberships

Introduce a dedicated `tenant-access` backend module, keeping payment recovery separate from ordinary login.

Authentication creates a limited central identity session, not a tenant business session. It permits membership discovery and handoff authorization only. Proposed limits: 30-minute idle timeout and 8-hour absolute expiry; expiry requires authentication again. Keep the identity session opaque, server-side, revocable, and carried by an HttpOnly, Secure, host-only cookie through the hosting adapter.

Eligibility requires an active identity, active staff membership, active tenant, and usable unit access under the existing rules. Apply existing package/subscription access rules without inventing a new billing restriction. Revalidate at selection and handoff redemption.

Return only the authenticated person's eligible memberships. Each picker row includes tenant ID, name, current slug, optional logo, and role label. Paginate/search server-side for users with many memberships; return an authoritative total count so auto-selection does not depend on the first page length.

Suggested typed results:

```ts
type StaffLoginResult =
  | { next: 'tenant_redirect'; startUrl: string }
  | { next: 'tenant_selection'; eligibleCount: number }
  | { next: 'no_access' }
  | { next: 'platform' }
  | { next: 'checkout'; order: OnboardingStatus };
```

For existing direct tenant login, an authorized user enters that tenant immediately. An unauthorized account gets a wrong-workspace message and a link to central login; it must not acquire that tenant's session. Pending onboarding retains checkout recovery, without hiding other active memberships a user may already have. The central platform-admin flow remains separate from the cooperative selector.

## 5. Secure cross-domain handoff

Changing `window.location` alone cannot transfer the host-only session. Use an authorization-code-style handoff with destination browser binding, transaction state, and PKCE S256; do not put Firebase ID tokens, access tokens, or refresh tokens in URLs.

Sequence:

1. After auto-selection or an explicit selection, the backend records an expiring login attempt bound to the authenticated identity, selected membership, canonical destination, and `/dashboard` return path. The client supplies a tenant ID, never an arbitrary destination URL.
2. Navigate to the selected tenant's `/auth/start`. This creates a destination-browser binding and an independent transaction with state and a PKCE challenge/verifier. No business session is issued here.
3. Top-level navigation returns to the central authorization endpoint. Verify its identity cookie, the selected identity/membership, and the transaction. A different signed-in central identity cannot approve that attempt.
4. Issue an opaque, random, single-use code bound to that transaction, identity, membership, exact canonical origin/callback, and PKCE challenge. Proposed code lifetime: 60 seconds. Store only its hash; login attempts expire after five minutes.
5. Redirect to the exact tenant callback. Redeem through the tenant's same-origin API with state, the destination browser binding, and PKCE proof. Verify signed gateway context, current identity/membership status, and canonical host. Consume the code atomically with session issuance.
6. Issue the normal tenant-scoped session using the selected existing `User` record and freshly derived role/unit permissions. Clear the temporary transaction and immediately replace the callback URL with `/dashboard`.

The destination must establish its browser binding before the code is issued. Single-use codes alone do not prevent login CSRF or code injection.

Additional requirements:

- Exact allowlisted destinations resolved by the server; retain current tenant-domain validation.
- Handoff pages use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, load no analytics, and redact code/state values from application, proxy, and access logs.
- State-changing endpoints validate origin/CSRF protections. Reject replay, wrong browser, wrong verifier, wrong tenant, and identity changes.
- Multiple tabs get separate attempts; do not use a single mutable global "selected tenant" value.
- If the tenant is renamed during the handoff, invalidate/restart with its current canonical host. Never redeem against an obsolete alias.
- Membership removal or tenant deactivation during selection causes a recoverable access error.
- Prototype the cookie flow through both central Firebase Hosting and the tenant gateway before completing UI work. Preserve existing staff/member cookie separation.
- A successful staff login has no generic-host business session. Existing generic staff dashboard sessions are routed through identity selection when the feature is enabled. Enforce canonical-host use for browser staff sessions in the API as well as the UI; distinguish platform/service integrations explicitly rather than relying on a caller-supplied Origin header.

This is a proposed application handoff design, not a claim of OAuth certification. Implementation should follow the redirect, code-injection, and PKCE protections described in [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) and [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html).

## 6. Frontend flow and modal

Create `features/tenant-access/` with a reusable `TenantPickerDialog`, typed API client, login coordinator, and callback page.

- Multiple eligible memberships: modal title **Pilih Koperasi**, explanatory text, searchable rows showing name, slug/domain, and role, and a **Masuk** button for the selected row.
- Keep the modal open until selection or explicit cancellation. Cancel signs out the limited identity flow and returns to login; it never opens a generic dashboard.
- One eligible membership: skip the modal and show a short redirecting state.
- Zero eligible memberships: show the explicit no-access state.
- Preserve loading, retry, empty search, membership-revoked, and expired-login states.
- Use the existing dialog components, keyboard navigation, focus management, and mobile-friendly sizing.
- Use full-page navigation for host changes. Establish the session and load tenant data only on the destination origin.
- Guard the generic `/dashboard` and other staff business routes before rendering cached tenant content. Existing bookmarks must lead into the canonical flow.

## 7. Optional dashboard switching

Phase 2 adds **Ganti Koperasi** to the topbar, displaying the current koperasi and available alternate memberships.

- Only show the switch action when more than one eligible membership exists.
- Reuse the modal; label the current tenant and make selecting it a no-op.
- Resolve memberships from the authenticated identity and recheck access server-side.
- Use the same destination handoff. The central identity session can authorize the change; if expired, authenticate again and resume the requested selection.
- Always land on the destination `/dashboard`, without carrying record IDs, filters, or unsaved forms from the source tenant.
- Warn before abandoning unsaved edits. Cancel or a failed switch leaves the source session usable.
- Full navigation gives each tenant its own origin-scoped state. Keep tenant IDs in relevant query keys and do not reuse source tenant caches.
- Existing tabs may remain logged into their original tenant. Switching is a navigation action, not a global mutation of every tab's tenant.

Logout policy: ordinary logout ends the current tenant session and the central identity session, preventing silent re-entry through the selector. Other already-established tenant sessions remain independent; a future "sign out everywhere" action is outside this phase. Central logout must be completed via top-level navigation when needed for cookie access, and failures must not be reported as successful global logout.

## 8. Backend and infrastructure change map

| Area | Planned work |
| --- | --- |
| Prisma schema/migrations | Global identity, membership linkage, invitation records, identity sessions and expiring handoff transactions. |
| `modules/tenant-access/` | Authentication coordination, membership listing/selection, canonical destination resolution, handoff, logout. |
| `modules/onboarding/` | Delegate normal sign-in to identity-aware flow; preserve signup/payment recovery and platform login. |
| `modules/auth/`, middleware, user mapper | Issue sessions for selected membership; use linked identity for Firebase revocation/profile rules; keep tenant claims and gateway checks. |
| `modules/users/`, `identity-provisioning/`, platform provisioning | Create/invite memberships and reconcile shared identities safely. |
| Tenant scope helper | Explicit narrow identity lookup paths; retain tenant-scoped business queries. |
| `packages/types/` | Login result union, membership summaries, invitation/handoff response contracts. |
| Frontend auth/layout | Modal, central route guards, callback handling, optional topbar switcher. |
| Hosting adapter and tenant gateway | Cookie handling, authentication endpoints, callback serving, headers and sensitive-query redaction. |
| Release pipeline | Additive migration order, feature flags, hosted handoff smoke checks. |

Proposed API grouping: central `/api/tenant-access/login`, `/memberships`, `/select`, `/authorize`, `/logout`; tenant `/api/tenant-access/start` and `/redeem`; tenant-scoped membership invitations under user management. HTTP methods, cookie paths, and gateway allowlists must be specified together during implementation. Start/redeem never trust the browser to assert a tenant identity.

## 9. Migration and delivery phases

### Phase 1A — Identity and membership foundation

- Add nullable identity links and supporting tables.
- Backfill current Firebase users by existing UID; preserve staff IDs and legacy accounts.
- Update every UID lookup, creation/linking path, profile path, revocation check, and recovery job.
- Implement invitation acceptance and tests that one identity can belong to two tenants with different roles.
- Verify row counts and referential integrity without printing credentials or changing real users' access.

### Phase 1B — Canonical login and selector

- Implement/test the browser-bound handoff, then connect single-tenant automatic routing and the multi-tenant modal.
- Preserve tenant-direct login, platform login, onboarding checkout, and legacy tenant login.
- Generic legacy email/password discovery is not safe under the current per-tenant identity model. Offer workspace-specific legacy login until users explicitly link/migrate; do not silently merge or reset accounts.
- Add guards for existing generic staff URLs and update the login response contract.

### Phase 2 — Optional dashboard switcher

- Add the topbar action and reuse the established selection/handoff flow.
- Verify cancellation, unsaved changes, independent tabs, role changes, and source/destination sessions.

### Rollout and rollback

- Use separate feature flags for canonical login/selection and optional dashboard switching; flag names to be finalized in implementation.
- First deploy a compatibility release that understands identity links while retaining old login behavior. Keep `User.firebaseUid` temporarily for rollback compatibility; new code uses `AccountIdentity` as the source of truth.
- Enable multiple memberships only after all API and recovery-job revisions understand the new model. The oldest permitted rollback release must support shared identities; do not roll back to a revision that assumes one UID per tenant user.
- Backfill before enabling the login feature. Remove obsolete identity fields in a later migration after compatibility checks.
- Rollback disables new selector/handoff entry points and preserves direct canonical tenant login; optional switching can be disabled independently. Keep additive data and expire temporary attempts.
- Use the repository's coordinated central/tenant release pipeline. Enable only after the same compatible revision is serving both origins and HTTPS/cookie smoke tests pass.

## 10. Acceptance and E2E tests

Use synthetic single-tenant and multi-tenant identities in a dedicated test/preview database. Automated repository tests must never target the staging database because existing suites delete tenant data. Hosted tests use dedicated synthetic staging koperasi and explicitly prepared accounts; do not grant real PTAP users extra memberships for testing.

| Scenario | Required result |
| --- | --- |
| One active membership | Central login skips modal and ends at the tenant `/dashboard`; correct data and role. |
| Two active memberships | Modal lists exactly those two; either selection reaches its canonical host and dashboard. |
| One active plus inactive membership | Auto-select the sole eligible membership. |
| Zero memberships | No business session; clear access-unavailable state. |
| Invitation acceptance | Verified existing identity joins a second tenant with only the assigned permissions; replay/wrong recipient rejected. |
| Membership revoked after listing | Selection/redemption denied; no stale tenant session issued. |
| Unauthorized tenant ID | Server rejects it even if the client request is modified. |
| Handoff protections | Expired/replayed code, wrong origin, browser binding, state, identity, and PKCE proof rejected; concurrent redemption has one winner. |
| Lost response after redemption | Retry/restart is recoverable; cannot consume the same code twice. |
| Rename during selection/handoff | Resolve/restart at current canonical slug; no alias session issued. |
| Existing central staff bookmark/session | Enters selection/canonical redirect; tenant data never renders on generic hostname. |
| Direct canonical login | Matching membership succeeds; wrong-tenant account is denied. |
| Reload/deep link on tenant host | Tenant session refreshes and retains the correct tenant. |
| Platform administrator | Central platform dashboard remains available; no implicit tenant access. |
| Pending checkout plus active membership | Active koperasi remain accessible; payment recovery is still available separately. |
| Legacy staff account | Existing tenant-specific login works; no accidental identity linking. |
| Existing member portal auth | Staff identity changes do not modify member-session behavior. |
| Optional switch A to B | B host/data/role, no A cache or IDs; A tab remains scoped to A. |
| Switch cancellation/failure | Source dashboard remains usable. |
| Logout | Current tenant and central identity session end; expired grants cannot silently reopen access. |

Run relevant backend auth, tenancy, provisioning, and hosting suites plus TypeScript/lint. Use the Browser skill for rendered modal, redirect, reload, mobile viewport, keyboard, and console checks. Verify real Google and email/password login on HTTPS; emulator results do not prove hosted cross-domain cookies or redirects.

## 11. Definition of done

Core release is complete when linked staff identities can have multiple authorized memberships, single-tenant login redirects automatically, multi-tenant login requires modal selection, and every successful cooperative staff dashboard uses the current tenant domain with the correct role/data. Compatibility and negative tests must pass, and a hosted E2E run must demonstrate both login branches. Optional dashboard switching is tracked separately and is complete only after its own E2E cases pass.
