# Generic member login

## Behavior

`/anggota/login` on the central site accepts NIK and password directly. The API
verifies each active, activated membership with that NIK against its own password.
One match redirects automatically; multiple matches open a koperasi selection
dialog. Memberships with a different password are not shown. A tenant's own
`/anggota/login` continues to authenticate only that tenant.

Successful login ends on the canonical tenant host at `/anggota/dashboard`, or
`/anggota/ganti-password` when the initial password must be replaced.

## Session transfer

The central browser receives a five-minute, HttpOnly selection cookie, not a
member access token. The database stores its hash and grants for verified members.
A grant records a digest of the credential version, so password resets invalidate
pending transfers. Expired selection sessions and their grants/attempts are removed
on subsequent login requests.

Selection creates a one-use attempt bound to the canonical tenant origin. The
destination sets a separate HttpOnly browser binding and returns to the central
site for authorization. Authorization requires the original selection cookie.
The callback carries a 60-second code in the URL fragment; redemption requires
the destination cookie, state and verifier, then atomically consumes the attempt.
It rechecks account activity, tenant activity, credential version and tenant slug.
Passwords never appear in URLs, and portal tokens are issued only at the tenant.

Firebase Hosting translates the central cookie through `__session` on the
dedicated `/api/member-access` path. Staff and member portal cookies retain their
existing paths. API responses are not cached; the member document suppresses
referrers. Login requests have per-NIK and per-process IP rate limits.

## Deployment

The additive migration `20260915170000_member_login_selection` adds three temporary
authentication tables and an index on `Member.nik`. Existing credentials are not
changed. The release pipeline already applies migrations before publishing apps.

This flow uses existing `TENANT_DOMAINS_ENABLED`, `TENANT_BASE_DOMAIN` and
`PUBLIC_APP_URL` configuration. It does not depend on the staff selection/switching
flags. For browser builds, set `VITE_PUBLIC_APP_URL` and `VITE_TENANT_BASE_DOMAIN`
when using another deployment; defaults point to the current staging namespace.

## Verification flows

1. Generic login, one match: enter NIK/password → automatic tenant handoff → dashboard.
2. Multiple matches: enter NIK/password → select one verified koperasi → that tenant's portal.
3. Initial password: either path above → forced password change; save a new password,
   log out, then generic login with the new password → dashboard.
4. Negative cases: wrong password/unknown NIK, unactivated or inactive membership,
   unauthorized selection, foreign origin, stolen/replayed callback, changed
   password/slug, expired session/code. No unauthorized portal session is issued.

Integration tests: `apps/backend/tests/member-access.test.ts`, plus the existing
member authentication and portal suites. Use a disposable `_test` database.
