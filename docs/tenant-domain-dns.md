# Tenant domain DNS setup

Firebase project: `siskop-d0f8c`

App Hosting backend: `siskop-tenants` (Singapore)

Tenant namespace: `*.koperasi.inovasijayakarsa.id`

In Vercel, open the **inovasijayakarsa.id** domain → **DNS Records**. Add these records (names are relative to that domain):

| Type | Name | Value |
| --- | --- | --- |
| A | `*.koperasi` | `35.219.201.39` |
| TXT | `*.koperasi` | `fah-claim=00b-02-7e16e73f-2760-4f58-ad8a-ca0bd1d8b13a` |
| CNAME | `_acme-challenge_clh3p2gvf4imk53y.koperasi` | `eec5efae-6f7d-46c6-8db8-75aa6533c99d.14.authorize.certificatemanager.goog` |

Use the default TTL. Keep these ownership and certificate records permanently so Firebase can renew HTTPS.

If Vercel already has an explicit A/AAAA/CNAME record for **exactly** `*.koperasi` or the certificate challenge name, replace only that conflicting record. Firebase currently sees Vercel IPs at those names; these may be inherited from the existing parent wildcard. Do not delete the company website's root records, its parent wildcard, or Resend email records. Adding the more specific records above should override inherited wildcard answers.

After saving, report that DNS is saved. We will verify propagation and Firebase's `HOST_ACTIVE`, `OWNERSHIP_ACTIVE`, and `CERT_ACTIVE` states before activating redirects or address editing. DNS/certificate validation can take time; saving a record does not mean HTTPS is ready yet.

Records retrieved directly from Firebase App Hosting on 14 September 2026. If the backend/domain is recreated, run `node infra/tenant-web/domain-setup.mjs status` to obtain current values rather than reuse an old certificate challenge.
