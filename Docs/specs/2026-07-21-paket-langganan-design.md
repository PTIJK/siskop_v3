# Design Spec — Paket Langganan (Module-Level Package Entitlements)
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Modul** | Host (Super Admin) — Paket Langganan |
| **Tanggal** | 21 Juli 2026 |
| **Status** | Approved for planning |
| **Terkait** | 01-PRD-SISKOP.md §6.8 (ADM-04, ADM-05), 03-ERD-SISKOP.md §2.1 (SubscriptionPackage), §2.7 (SavingConfig) |

---

## 1. Background & Problem

The current `SubscriptionPackage` model gates access at the whole-module level only (`modules: String[]`). New requirements need finer control:

1. Packages must differentiate what a tenant can configure *within* a module, not just which modules are visible.
2. Every tenant, regardless of package, gets two default Simpanan types (Wajib, Sukarela) plus the always-on Simpanan Pokok (required for loan eligibility — unchanged from existing LOAN-02).
3. Tenants on the top-tier package can create additional custom Simpanan configs beyond the defaults (e.g., a "Simpanan Haji" — this is just an example name a tenant might choose, not a curated product).
4. Some packages unlock "whitelabel" configuration for the tenant (custom branding, custom domain, custom email sender identity).

## 2. Resolved Decisions (from requirements discussion)

| Question | Decision |
|---|---|
| Does Simpanan Pokok stay required for loan eligibility? | Yes — unchanged. Pokok is always-on regardless of package; it is not part of package differentiation. |
| Does the Tenant Pinjaman eligibility rule change? | No functional change. Existing rule (member must have Simpanan Pokok balance > 0) stays as-is. The only new Pinjaman-module work is a loan-type filter in the UI (see separate spec). |
| How granular is package control? | Modules *and* sub-features within a module (not just whole-module toggles). |
| Is "Simpanan Haji" a curated catalog item? | No — it's just an example. The real feature is a numeric cap on custom SavingConfig records a tenant can create; tenants name/configure them freely via the existing Simpanan Config screen. |
| How does a tenant add the extra feature? | Self-service — if their package allows it, the tenant admin can create the extra config themselves, no host approval step. |
| Whitelabel scope for v1? | All three: custom branding (colors, hide SISKOP branding), custom domain, custom email sender identity. |
| Enforcement layer? | Backend hard gate (new entitlement middleware), not just UI hiding. |
| Package downgrade behavior? | Freeze, don't delete — data outside the new package's entitlements stays in the database, becomes read-only / stops taking effect, and resumes if re-upgraded. |

## 3. Data Model Changes

### 3.1 `SubscriptionPackage` (extend existing)

| Column | Type | Notes |
|---|---|---|
| `maxSavingConfigs` | Int, nullable | Cap on *custom* SavingConfig records (`isDefault=false`) a tenant on this package may create. `null` = unlimited. |
| `whitelabelEnabled` | Boolean, default false | Gates access to `WhitelabelConfig` for tenants on this package. |

All other existing fields (`modules[]`, `maxUsers`, `maxMembers`, `price`, `isActive`) are unchanged.

### 3.2 `SavingConfig` (extend existing)

| Column | Type | Notes |
|---|---|---|
| `isDefault` | Boolean, default false | `true` for the 3 seeded records (Pokok, Wajib, Sukarela). Protected from deletion; excluded from the `maxSavingConfigs` count. |

### 3.3 `WhitelabelConfig` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `tenantId` | String, unique FK → Tenant | One config per tenant |
| `customDomain` | String, nullable, unique | e.g. `koperasiku.com` |
| `domainStatus` | Enum: `PENDING` \| `VERIFIED` \| `FAILED`, default `PENDING` | Set by domain verification job |
| `primaryColor` | String, nullable | Hex color for tenant theme |
| `hideBranding` | Boolean, default false | Hides "Powered by SISKOP" mentions |
| `emailSenderName` | String, nullable | Overrides default sender name on outbound email |
| `emailSenderAddress` | String, nullable | Overrides default sender address |
| `createdAt` / `updatedAt` | DateTime | Standard audit columns |

Prisma sketch:

```prisma
enum DomainStatus { PENDING VERIFIED FAILED }

model SubscriptionPackage {
  // ...existing fields
  maxSavingConfigs  Int?
  whitelabelEnabled Boolean @default(false)
}

model SavingConfig {
  // ...existing fields
  isDefault Boolean @default(false)
}

model WhitelabelConfig {
  id                 String       @id @default(cuid())
  tenantId           String       @unique
  tenant             Tenant       @relation(fields: [tenantId], references: [id])
  customDomain       String?      @unique
  domainStatus       DomainStatus @default(PENDING)
  primaryColor       String?
  hideBranding       Boolean      @default(false)
  emailSenderName    String?
  emailSenderAddress String?
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt
}
```

## 4. Tenant Registration Seeding

On `POST /api/auth/register-tenant` (existing flow, FSD §2.1), after creating the Tenant record, seed 3 `SavingConfig` rows with `isDefault=true`:

1. Simpanan Pokok — type `POKOK`
2. Simpanan Wajib — type `WAJIB`
3. Simpanan Sukarela — type `SUKARELA`

This happens regardless of assigned package. Rate/periodUnit defaults can be left at a sane platform default (e.g. 0%, MONTHLY) for the admin to adjust later.

## 5. Enforcement — Entitlement Middleware

New `apps/backend/src/middleware/entitlement.middleware.ts`, applied to the Simpanan Config and Whitelabel Config write routes (creation of a new `SavingConfig`, and any `WhitelabelConfig` write):

```
On POST /api/tenant/savings/configs:
  1. Load req.tenant.package (join)
  2. If package.maxSavingConfigs is not null:
       count = SavingConfig.count({ tenantId, isDefault: false })
       if count >= package.maxSavingConfigs → 422 PACKAGE_LIMIT_EXCEEDED
  3. Proceed to normal create logic (existing SAV-01 / CFG-06)

On POST or PUT /api/tenant/config/whitelabel:
  1. Load req.tenant.package
  2. If !package.whitelabelEnabled → 403 FEATURE_NOT_ENTITLED
  3. Proceed to normal upsert logic
```

New error codes to add to `api-conventions.md`:

| Code | HTTP | Description |
|---|---|---|
| `PACKAGE_LIMIT_EXCEEDED` | 422 | Tenant's package does not allow creating another resource of this type |
| `FEATURE_NOT_ENTITLED` | 403 | Tenant's package does not include this feature (e.g. whitelabel) |

## 6. Downgrade / Package Change Behavior

When a Host admin changes a tenant's `packageId` to one with a lower `maxSavingConfigs` or `whitelabelEnabled: false`:

- **No data is deleted.** Existing `SavingConfig` records beyond the new cap remain in the database and remain visible (read-only): balances still display, existing transactions still show in history, but no *new* deposit/withdrawal against configs beyond the allowed count, and the config cannot be edited.
  - Which configs count as "beyond the cap" is determined by creation order (oldest custom configs stay active, most recently created ones freeze first) — flag if you'd prefer tenant admin to choose which to keep active.
- **`WhitelabelConfig` freezes**, not deletes: custom domain routing stops resolving (falls back to `{slug}.siskop.com`), branding/email sender overrides stop applying, but the stored values remain so they reactivate automatically on re-upgrade.

## 7. Host UI Changes

`admin.siskop.com` → Paket Langganan management (extends ADM-04/ADM-05):

- Package form gains: **Batas Simpanan Custom** (number input, blank = unlimited) and **Aktifkan Whitelabel** (toggle).
- Package list/detail view surfaces these two new fields alongside existing price/user/member limits.

## 8. Tenant UI Changes

Tenant System Config → Simpanan Config screen:
- Shows a quota indicator ("2 dari 5 simpanan custom terpakai", or "Tak terbatas") above the config list.
- "Tambah Simpanan" button disabled with tooltip explaining the limit once quota is reached.

Tenant System Config → new **Whitelabel** tab (only rendered if `package.whitelabelEnabled`):
- Custom domain field + verification status badge (Pending/Verified/Failed) + instructions for the required CNAME record.
- Primary color picker, "Hide SISKOP branding" toggle.
- Email sender name/address fields.

## 9. Infra Note — Custom Domain

Custom domain support requires new capability beyond the current wildcard-SSL Nginx setup described in `04-System-Architecture-SISKOP.md` §12: per-tenant SSL certificate issuance (e.g. Certbot DNS-01 or ACME automation) and a domain-ownership verification step (DNS TXT or CNAME check) before `domainStatus` can move to `VERIFIED`. This is real infrastructure work, not just an app-layer config screen.

**Recommendation:** ship custom branding + email sender identity first (pure app-layer), and treat custom domain as a fast-follow once the cert-automation approach is chosen. This spec covers the data model for all three; sequencing is a delivery decision, not a design blocker.

## 10. Explicit Assumptions

- `LoanConfig` (Pinjaman configuration) remains **ungated** by package — no `maxLoanConfigs` field, since the requirements only specified a Simpanan default/limit. Flag if Pinjaman should also be capped.
- Rate/periodUnit values for the 3 seeded default SavingConfig records default to a platform-wide placeholder (0%, MONTHLY); tenant admin is expected to adjust immediately post-registration via existing CFG-06.
- Which specific custom configs freeze first on downgrade (oldest-first) is a default assumption — confirm or override before implementation.

## 11. Out of Scope (this spec)

- Host "Module Koperasi" logo feature (separate spec)
- Host System Configuration — user management (separate spec)
- Notification module (separate spec)
- Tenant System Configuration — role/user/pinjaman config, logo change (separate spec)
- Tenant Pinjaman module — type filter (separate spec; eligibility logic confirmed unchanged in §2 above)
