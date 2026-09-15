# Tenant-domain verification — 14 September 2026

Branch: `codex/tenant-subdomains`, created from `origin/main` at `f92d0aa`.

## Completed locally

| Check | Result |
| --- | --- |
| Backend integration/unit suite | 492 tests across 43 files passed |
| Backend coverage | 95.32% lines, 85.36% branches, 94.31% functions |
| Release coordinator | 22 tests passed |
| Node tenant gateway | 2 integration tests passed |
| Backend/frontend TypeScript | Passed |
| Backend/frontend ESLint | Passed |
| Frontend Vite staging build | Passed |
| Git whitespace check | Passed |

The backend suite used only `siskop_landing_test` at `127.0.0.1:55433`.
Migrations were also applied to a separate local preview database. No Cloud SQL
migration or API deployment was performed for this feature during these checks.

## Cloud Build verification

[Build 57a6e047-bcca-4b46-8f55-01c5c96717fb](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/57a6e047-bcca-4b46-8f55-01c5c96717fb?project=866351101735)
completed with **SUCCESS** at 05:43 UTC. It used an archive of committed source
`a21f2fc`, with `_DEPLOY=false`. All 492 backend tests, 22 release tests, gateway
tests, lint, TypeScript checks, workspace/frontend builds and the compiled Node
container import passed. CI coverage was 95.32% lines and 85.46% branches.

The verified API image is
`asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:692a641e4e6ce4cf914137ca3773602dfa8edc78d2b9cb2b0d24eb0c73d8c6e9`.
It was built and pushed only; the release coordinator skipped Cloud SQL migration
and both hosting deployments. This does not verify the first App Hosting rollout.

CI caught a shell-variable escaping error in the Cloud Build template and a
missing `.js` extension in the shared type barrel; both were corrected before
the successful build. Local verification now also executes the compiled types
with plain Node. The following documentation-only commit does not change the
tested application or infrastructure source.

Meaningful cases include matching and mismatching tenant tokens/refresh cookies,
member-token isolation, central-only platform access, forged/stale gateway
assertions, inactive/unknown/reserved tenants, verified-payment activation,
server-generated registration slugs, concurrent rename attempts, contested
names, retired alias protection, permissions, entitlement expiry/downgrade,
annual cooldown, and Firebase provisioning recovery after interruption.

## Browser checks

Used the existing Vite frontend through the new Node gateway, a separate local
API/database and Firebase Auth emulator (`demo-siskop-tenants`).

- Alpha and Beta displayed their own koperasi names and accepted their respective
  email/password accounts.
- Alpha credentials on Beta's host were rejected without opening a dashboard.
- A fresh password confirmation renamed Alpha from `alpha-preview` to
  `alpha-renamed`, then redirected to login on the new hostname.
- Signing in on the new hostname and reloading `/config` retained the session.
- Settings showed the 14 September 2027 next-change date and rename history.
- The old address redirected `/config?alias-check=1` to the same path/query on
  the canonical hostname.
- An unknown workspace showed the unavailable screen and central-site link.
- The settings tab bar was corrected after screenshot review; the final 1280px
  view has no document overflow or tab/card overlap.
- A Google emulator identity with no SISKOP binding was rejected. A successful
  real Google login on the deployed tenant domain is still pending.

## Cloud preparation and remaining checks

Created the `siskop-tenants` App Hosting backend in Singapore and its wildcard
domain resource. Configured the private gateway secret, narrow runtime Firebase
permissions, App Hosting deployment identity access, private source-upload
bucket, and Firebase Auth's authorized tenant namespace.

Firebase still reported HOST_NON_FAH, OWNERSHIP_MISSING and CERT_VALIDATING at
the final check. Exact DNS records are in [the DNS sheet](tenant-domain-dns.md).
No tenant App Hosting build/rollout has completed yet. The main deployment
trigger has not been switched to enable tenant hosting or address changes.

The feature branch is pushed. Automatic draft PR creation was rejected by the
GitHub integration with HTTP 403 (`Resource not accessible by integration`).
Create it from `codex/tenant-subdomains` into `main` after reviewing the branch.

Before activating customer redirects: verify DNS/HTTPS, merge through review,
deploy the coordinated main release, and test two real hosted tenant contexts,
both login providers and sandbox payment completion. Enable address editing
only after those checks pass. Local emulator results do not prove hosted OAuth
or App Hosting build/edge behavior.
