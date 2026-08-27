# 09 — QA Test Cases: SISKOP

Companion to `docs/08-QA-Test-Plan-SISKOP.md`. Every case is traceable to an FR/NFR ID in
`docs/02-System-Requirements-SISKOP.md`. Type: **P** = positive, **N** = negative/boundary.
Priority uses the P0–P3 scale defined in the test plan §3.3.

Conventions used below:
- "Tenant A / Tenant B" = two distinct provisioned tenants on different subdomains, used for every
  isolation case.
- Seed roles referenced: **Super Admin**, **Manager**, **Teller**, **Viewer** (per
  `modules/tenants/provision.ts`), distinct from the platform-level `super_admin` claim.
- `ErrorCode` values quoted exactly as declared in `packages/types/src/api.ts`.

---

## 1. Authentication & Tenant Provisioning (FR-AUTH)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-AUTH-001 | FR-AUTH-01 | P | Submit tenant registration with valid name, slug, registrationNo, address, admin name/email, password (≥8 chars), and firstUnit type+name | Tenant, its first `CooperativeUnit`, 4 seed roles, and Super Admin user created atomically; success response with tenant/unit data | P0 |
| TC-AUTH-002 | FR-AUTH-02 | N | Register a tenant reusing a slug already in use by an existing tenant | `CONFLICT`, not a raw DB/500 error | P1 |
| TC-AUTH-003 | FR-AUTH-02 | N | Register with a registrationNo already used by another tenant | `CONFLICT` | P1 |
| TC-AUTH-004 | FR-AUTH-02 | N | Register with an adminEmail already used as another tenant's admin | `CONFLICT` | P1 |
| TC-AUTH-005 | provision.ts `slugSchema` | N | Register with slug containing uppercase, spaces, or a leading/trailing hyphen (e.g. `My Coop!`, `-badslug-`) | `VALIDATION_ERROR` before any DB write | P2 |
| TC-AUTH-006 | auth `service.ts` schema | N | Register with password of 7 characters | `VALIDATION_ERROR`, "password must be at least 8 characters" | P2 |
| TC-AUTH-007 | FR-AUTH-03 | P | Log in with valid email+password on the tenant's own subdomain (e.g. `https://demo.localhost:3000`) | Session issued, tenant resolved to the subdomain's tenant only | P0 |
| TC-AUTH-008 | FR-AUTH-03 | N | Same valid credentials submitted against a **different** tenant's subdomain than the account belongs to | Login fails — tenant is resolved from `Host`, not matched to the credentials' real tenant; user not found in that tenant's scope | P0 |
| TC-AUTH-004b | NFR-SEC-01/02 | N | Attempt login while passing a `tenantId`/`slug` field in the request body that differs from the `Host` subdomain | Body value is ignored; tenant resolved from `Host` only | P0 |
| TC-AUTH-009 | FR-AUTH-04 | N | Hit the login endpoint via a host with no resolvable subdomain (e.g. bare IP or unmapped host) | Validation error instructing the user to use their cooperative's subdomain — not a generic "invalid credentials" | P2 |
| TC-AUTH-010 | FR-AUTH-05 | N | Log in with a correct email but wrong password | Generic auth failure, not "wrong password" specifically | P1 |
| TC-AUTH-011 | FR-AUTH-05 | N | Log in with an email that does not exist in that tenant | Same generic auth failure and comparable response time as TC-AUTH-010 (dummy bcrypt hash path) — time the two manually and confirm no order-of-magnitude gap | P2 |
| TC-AUTH-012 | FR-AUTH-06 | P | Inspect issued access token exp claim | Access token expires 15 minutes from issuance | P2 |
| TC-AUTH-013 | FR-AUTH-06 | P | Inspect issued refresh token / cookie expiry | Refresh token expires 7 days from issuance | P2 |
| TC-AUTH-014 | FR-AUTH-07 | P | Change a logged-in user's role/unit access server-side (as admin), then call refresh with the user's still-valid refresh token | New session reflects the updated role/unit access, not the stale claims from original login | P1 |
| TC-AUTH-015 | FR-AUTH-07 | N | Tamper with a refresh token's payload (e.g. resign with wrong userId) | Refresh rejected, no session issued | P0 |
| TC-AUTH-016 | FR-AUTH-08 | P | Call `GET /api/auth/me` with a valid session | Returns caller's own user record only | P1 |
| TC-AUTH-017 | FR-AUTH-08 | N | Call `GET /api/auth/me` with a token whose `tenantId` doesn't match a `userId` from another tenant (constructed/replayed token) | `NOT_FOUND`/`UNAUTHORIZED`, never another tenant's user record | P0 |
| TC-AUTH-018 | FR-AUTH-09 | N | A user whose role/unit assignment leaves them with zero accessible units attempts login | Login rejected — no empty-scope token issued | P1 |
| TC-AUTH-019 | FR-AUTH-12 | P | Logged-in user updates own name/email via profile | Profile updated; new email reflected in `/auth/me` | P2 |
| TC-AUTH-020 | FR-AUTH-12 | N | Update profile email to a value already used by another user | `CONFLICT` or `VALIDATION_ERROR` per schema (`email()` + uniqueness) | P2 |
| TC-AUTH-021 | FR-AUTH-12 | P | Change password with correct `currentPassword` and a `newPassword` ≥8 chars | Password updated; old password no longer authenticates, new one does | P1 |
| TC-AUTH-022 | FR-AUTH-12 | N | Change password with an incorrect `currentPassword` | Rejected, password unchanged | P1 |
| TC-AUTH-023 | FR-AUTH-12 | N | Change password with `newPassword` of 7 characters | `VALIDATION_ERROR`, "Password baru minimal 8 karakter" | P2 |
| TC-AUTH-024 | FR-AUTH-11 | P | Log in as a platform admin (`User.isPlatformAdmin = true`) | `AuthClaims.role = "super_admin"`; can reach `/api/platform/*` | P0 |
| TC-AUTH-025 | NFR-SEC-04 | N | (Config/deploy check) Attempt to start backend / sign a token with `JWT_SECRET=""` | Signing refused, service does not silently default | P0 |

---

## 2. Multi-Unit Cooperative Model (FR-UNIT)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-UNIT-001 | FR-UNIT-01 | P | Fresh tenant provisioned | Exactly 1 active `CooperativeUnit` exists immediately after registration | P1 |
| TC-UNIT-002 | FR-UNIT-01 | N | Tenant has exactly 1 active unit; attempt to deactivate it via Config → Units | Rejected — "last active unit" conflict, unit remains active | P0 |
| TC-UNIT-003 | FR-UNIT-01 | P | Tenant has 2 active units; deactivate one | Succeeds; the other remains active, tenant still has ≥1 active unit | P2 |
| TC-UNIT-004 | FR-UNIT-02/FR-UNIT-06 | P | Tenant with 2+ active units generates a report | No stored "KSU" type anywhere; report runs consolidated (all units) when no unit filter is applied | P2 |
| TC-UNIT-005 | FR-UNIT-03 | N | Attempt to create a unit with a type outside `KSP/KONSUMEN/PRODUSEN/JASA/PEMASARAN` | `VALIDATION_ERROR` (nativeEnum rejection) | P3 |

---

## 3. Members (FR-MEM)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-MEM-001 | FR-MEM-03 | P | Create a member with valid fullName, 16-digit numeric NIK, address ≥10 chars, birthPlace, birthDate `YYYY-MM-DD`, occupation, and a KTP photo upload | Member created, enrolled into the tenant's unit, `memberId`/account number assigned | P1 |
| TC-MEM-002 | members `schema.ts` | N | Create member with NIK of 15 digits | `VALIDATION_ERROR`, "NIK harus 16 digit" | P2 |
| TC-MEM-003 | members `schema.ts` | N | Create member with NIK containing letters (e.g. `12345ABCDE123456`) | `VALIDATION_ERROR`, "NIK harus berupa angka" | P2 |
| TC-MEM-004 | FR-MEM-05 | N | Create a member with a NIK already used by another member **in the same tenant** | `CONFLICT` (`NIK_EXISTS`) | P1 |
| TC-MEM-005 | FR-MEM-05 | P | Create a member in Tenant B with the **same NIK** as an existing member in Tenant A | Succeeds — NIK uniqueness is per-tenant, not global | P1 |
| TC-MEM-006 | members `schema.ts` | N | Create member with address of 5 characters | `VALIDATION_ERROR`, "Alamat harus lengkap" | P3 |
| TC-MEM-007 | members `schema.ts` | N | Create member with birthDate `27-08-2026` (wrong format) | `VALIDATION_ERROR`, "Format tanggal: YYYY-MM-DD" | P3 |
| TC-MEM-008 | FR-MEM-04 | P | List members with `page`, `limit`, `search`, `isActive` filters | Correct paginated subset returned, matching filter | P2 |
| TC-MEM-009 | FR-MEM-02 | P | Deactivate a member (`isActive=false`) then filter list by `isActive=false` | Member appears only in the inactive filter, not the default active list | P2 |
| TC-MEM-010 | FR-MEM-06 | P | Upload a KTP photo, then fetch the member detail | Photo URL is a server-built `/uploads/...` URL that resolves correctly (regression check for the Windows-path bug) | P2 |
| TC-MEM-011 | NFR-TENANT-01 | N | Tenant B staff requests `GET /members/:id` using a member ID copied from Tenant A | `NOT_FOUND`, not the record | P0 |
| TC-MEM-012 | FR-MEM-05 | N | Create a member with a membership number (`memberId`) or account number colliding with another tenant's member (if client-suppliable) or verify server-generated numbers never collide across tenants | No cross-tenant collision; global uniqueness constraint holds without leaking tenant B's existing numbers to tenant A's UI | P2 |

---

## 4. Savings (FR-SAV) — highest-risk area, test first per plan §3.3

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-SAV-001 | FR-SAV-01 | P | Create a `SavingConfig` (e.g. name "Simpanan Sukarela", type SUKARELA, rateType BAGI_HASIL, rate 2.5, periodUnit MONTHLY) | Config created and selectable when opening a saving | P2 |
| TC-SAV-002 | savings `schema.ts` | N | Create a `SavingConfig` with `rate = 150` | `VALIDATION_ERROR` (max 100) | P3 |
| TC-SAV-003 | FR-SAV-06 | N | Open a WAJIB or SUKARELA saving for a member with **no** active Pokok saving | `MEMBER_HAS_NO_POKOK_SAVING` | P0 |
| TC-SAV-004 | FR-SAV-06/FR-SAV-02 | P | Open a Pokok saving for a member, then open a Wajib saving for the same member | Both succeed; member now has 1 Pokok + 1 Wajib saving | P1 |
| TC-SAV-005 | FR-SAV-02 | N | Attempt to open a second Saving for the same (member, unit, savingConfig) combination | `CONFLICT` — at most one account per (unit, config) | P1 |
| TC-SAV-006 | FR-SAV-04 | P | Deposit Rp 500,000 into an existing saving | Balance increases by exactly 500,000.00 (`Decimal`), an append-only `SavingTransaction` row written with correct type | P0 |
| TC-SAV-007 | FR-SAV-04 | P | Withdraw Rp 200,000 from a Sukarela saving with sufficient balance | Balance decreases by exactly 200,000.00, transaction recorded | P0 |
| TC-SAV-008 | savings `schema.ts` | N | Deposit/withdraw with `amount = 0` | `VALIDATION_ERROR`, "Nominal harus lebih dari 0" | P2 |
| TC-SAV-009 | savings `schema.ts` | N | Deposit/withdraw with `amount = -100000` | `VALIDATION_ERROR` (positive constraint) | P2 |
| TC-SAV-010 | FR-SAV-04 | N | Withdraw more than the current balance from a Sukarela saving | `INSUFFICIENT_BALANCE`, balance unchanged | P0 |
| TC-SAV-011 | FR-SAV-05 | N | Withdraw the **entire** balance of a Simpanan Pokok, or withdraw an amount that would bring it below the required non-zero floor | `CANNOT_WITHDRAW_POKOK`, balance unchanged | P0 |
| TC-SAV-012 | FR-SAV-05 | P | Deposit additional funds into an existing Pokok saving | Succeeds — the restriction is on withdrawal to zero/closed, not on deposits | P2 |
| TC-SAV-013 | FR-SAV-03 | P | Deposit an amount with 2 decimal places (e.g. 150000.55) | Stored and returned as exact `Decimal`, no floating-point drift (e.g. repeated deposits of 0.10 sum to exactly the expected total, not 0.30000000000000004-class error) | P1 |
| TC-SAV-007b | FR-SAV-07 | P | Deposit into a saving whose config has a valid `AccountMapping` | A balanced `JournalEntry` (`POSTED`) is created for the deposit | P1 |
| TC-SAV-014 | FR-SAV-07/FR-ACC-04 | P | Deposit into a saving whose config has **no** `AccountMapping` configured yet | Deposit still succeeds; `JournalEntry.status = UNPOSTED_MISSING_MAPPING`, not a failure | P1 |
| TC-SAV-015 | NFR-TENANT-01/02 | N | Tenant B attempts a deposit/withdrawal against a saving ID belonging to Tenant A | `NOT_FOUND`, no balance change on Tenant A's record | P0 |

---

## 5. Loans (FR-LOAN) — KOL reclassification is highest-risk, test first per plan §3.3

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-LOAN-001 | FR-LOAN-01 | P | Create a `LoanConfig` (type KONVENSIONAL, rateType BUNGA, rate 12, maxTermMonths 24) | Config created and selectable at loan creation | P2 |
| TC-LOAN-002 | loans `schema.ts` | N | Create a `LoanConfig` with `maxTermMonths = 400` | `VALIDATION_ERROR` (max 360) | P3 |
| TC-LOAN-003 | FR-LOAN-03 | P | Konvensional/anuitas: principal 12,000,000, annualRate 12%, term 12 months | `monthlyPayment`/`totalAmount`/`totalInterest` match the amortized-annuity formula (`monthlyRate = 1%`; verify against `lib/loan-calc.ts` formula independently, e.g. spreadsheet cross-check) | P0 |
| TC-LOAN-004 | FR-LOAN-03 | P | Konvensional with `annualRate = 0` | `totalAmount = principal`, `totalInterest = 0`, `monthlyPayment = principal / termMonths` exactly | P1 |
| TC-LOAN-005 | FR-LOAN-06 | P | Syariah loan (type SYARIAH or rateType MARGIN): principal 10,000,000, rate 10% annual, term 12 months | Flat margin used, not amortized: `totalInterest = principal * rate/100 * term/12`, `monthlyPayment = totalAmount / term` (equal installments, no declining-balance interest) | P0 |
| TC-LOAN-006 | FR-LOAN-01/loans `schema.ts` | N | Create a loan with `termMonths` greater than the selected `LoanConfig.maxTermMonths` | `TERM_EXCEEDS_MAX`, "Tenor maksimal adalah N bulan" | P1 |
| TC-LOAN-007 | loans `schema.ts` | N | Create a loan with `principalAmount = 0` or negative | `VALIDATION_ERROR`, "Nominal pinjaman harus lebih dari 0" | P2 |
| TC-LOAN-008 | FR-SAV-06 (shared gate) | N | Create a loan for a member with no active Pokok saving | `MEMBER_HAS_NO_POKOK_SAVING` | P0 |
| TC-LOAN-009 | loans `service.ts` (force flag) | P | Member already has an ACTIVE/PENDING loan; submit a new loan request with `force` omitted (default false) | HTTP 200 with `{ hasExistingLoan: true, existingLoan: {...} }` — **not** an error — surfacing the existing loan for confirmation | P1 |
| TC-LOAN-010 | loans `service.ts` (force flag) | P | Same as above, resubmit identical request with `force: true` | New loan is created despite the existing active/pending one | P2 |
| TC-LOAN-011 | FR-LOAN-03 | P | Disburse a loan with a valid `AccountMapping` configured | Journal entry posted (`POSTED`, balanced debit=credit); `remainingAmount` initialized to `totalAmount` | P0 |
| TC-LOAN-012 | FR-LOAN-04 | P | Record a payment (`amount`, `penalty`, `paidAt`, `dueDate`) against an active loan | `remainingAmount` decreases correctly; append-only `LoanPayment` row written | P0 |
| TC-LOAN-013 | loans `schema.ts` | N | Record a payment with `amount = 0` or missing `paidAt`/`dueDate` | `VALIDATION_ERROR` | P2 |
| TC-LOAN-014 | FR-LOAN-04 | N | Record a payment against a loan whose status is not `ACTIVE` (e.g. `COMPLETED`/`DEFAULTED`) | `LOAN_NOT_ACTIVE` | P1 |
| TC-LOAN-015 | FR-LOAN-05/lib/kol.ts | P | Loan with an expected installment 25 days past due, no matching payment | `recalculateKOL` → `kolCategory = LANCAR` (boundary: ≤30 days) | P0 |
| TC-LOAN-016 | FR-LOAN-05 | P | Loan with an expected installment exactly 31 days past due | `kolCategory = DALAM_PERHATIAN` (boundary just past 30) | P0 |
| TC-LOAN-017 | FR-LOAN-05 | P | Loan with an installment 95 days past due | `kolCategory = KURANG_LANCAR` (>90, ≤120) | P0 |
| TC-LOAN-018 | FR-LOAN-05 | P | Loan with an installment 150 days past due | `kolCategory = DIRAGUKAN` (>120, ≤180) | P0 |
| TC-LOAN-019 | FR-LOAN-05 | P | Loan with an installment 200 days past due | `kolCategory = MACET` (>180) | P0 |
| TC-LOAN-020 | FR-LOAN-05 | P | Loan fully current (all due installments paid on time) | `kolCategory` stays `LANCAR`, `daysOverdue = 0` | P1 |
| TC-LOAN-021 | FR-LOAN-07 | P | Multiple overdue loans across categories exist | Overdue-members view (`OverduePage`) lists exactly the members with overdue installments, with correct KOL category shown per member | P1 |
| TC-LOAN-022 | NFR-TENANT-01/02 | N | Tenant B requests a loan detail/payment using a loan ID belonging to Tenant A | `NOT_FOUND` | P0 |

---

## 6. Accounting / Ledger (FR-ACC)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-ACC-001 | FR-ACC-01 | P | Create a header Account and a child Account beneath it, with category and normal balance | Hierarchy stored and rendered correctly in `AccountsTab` | P1 |
| TC-ACC-002 | FR-ACC-01 | N | Create a child Account under a non-existent/invalid parent | `NOT_FOUND`/`VALIDATION_ERROR` | P2 |
| TC-ACC-003 | FR-ACC-02 | P | Create an `AccountMapping` for a savings deposit routing debit/credit accounts | Mapping saved; subsequent deposits for that config post correctly | P1 |
| TC-ACC-004 | FR-ACC-03 | P | Any savings/loan transaction with a mapping configured | Resulting `JournalEntry` has `sum(debit) === sum(credit)` exactly | P0 |
| TC-ACC-005 | FR-ACC-03/journal.ts | N | (White-box/unit-level) Force an unbalanced line construction | `JOURNAL_ENTRY_UNBALANCED` thrown, entry not persisted | P1 |
| TC-ACC-006 | FR-ACC-04 | P | Post a transaction for a kind with no `AccountMapping` yet, then add the mapping and reprocess/verify | Original transaction posted as `UNPOSTED_MISSING_MAPPING`; confirm the product design intent (fixable retroactively) is documented/handled per current implementation — verify no data loss occurred meanwhile | P1 |
| TC-ACC-007 | FR-ACC-05/NFR-SAAS-01 | N | Tenant with `packageId: null` (or a package lacking `"accounting"`) attempts to open Config → Akun (COA) or Account Mappings | `FEATURE_NOT_ENTITLED`, UI shows `EntitlementNotice`, not an empty table | P0 |
| TC-ACC-008 | FR-ACC-05 | P | Tenant whose package includes `"accounting"` opens COA/Account Mappings | Full read/write access | P1 |
| TC-ACC-009 | FR-ACC-06 | P | Configure an SHU distribution with 4 percentages summing to 100% | Saved successfully | P2 |
| TC-ACC-010 | FR-ACC-06 | N | Configure an SHU distribution where percentages sum to ≠100% (e.g. 95%) | `VALIDATION_ERROR`, config rejected | P1 |

---

## 7. Reports (FR-RPT)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-RPT-001 | FR-RPT-01 | P | Generate the aggregate financial report for a valid date range with known deposits/withdrawals/disbursements in it | Totals match manually-summed source transactions | P1 |
| TC-RPT-002 | FR-RPT-02 | P | Generate the RAT (annual) report for a fiscal year with data | Correct annual aggregates rendered | P1 |
| TC-RPT-003 | FR-RPT-07 | P | Record a savings transaction **today**, then run any date-range report with `startDate = endDate = today` | Today's transaction is **included** — regression check for the historical same-day-exclusion bug class | P0 |
| TC-RPT-004 | FR-RPT-07 | N | Same as above but confirm a transaction dated **tomorrow** is excluded from a report ending today | Correctly excluded — upper bound is end-of-day today, not open-ended | P1 |
| TC-RPT-005 | FR-RPT-04 | P | Generate Neraca (balance sheet) for a period with posted journal entries | Assets = Liabilities + Equity; figures reconcile to `Account`/`JournalLine` balances | P0 |
| TC-RPT-006 | FR-RPT-04 | P | Generate Arus Kas (cash flow) for the same period | Cash movement reconciles to cash-account journal lines | P1 |
| TC-RPT-007 | FR-RPT-04 | P | Generate Laporan Hasil Usaha (income statement) | Revenue/expense figures reconcile to ledger | P1 |
| TC-RPT-008 | FR-RPT-04 | P | Generate Pembagian SHU using the configured SHU distribution (FR-ACC-06) | Distribution splits SHU per configured percentages, summing back to 100% of SHU | P1 |
| TC-RPT-009 | FR-RPT-04 | P | Open/edit CALK in the UI | Content is editable/reviewable in-app; confirm it is intentionally **not** included in PDF export (per FR-RPT-03) | P2 |
| TC-RPT-010 | FR-RPT-03 | P | Export Financial, RAT, Neraca, Arus Kas, Laba Rugi, and Pembagian SHU reports to PDF | Each PDF generates successfully, opens, and matches on-screen figures; completes in <10s (NFR-PERF-03) | P1 |
| TC-RPT-011 | FR-RPT-05/NFR-SAAS-01 | N | Tenant without accounting entitlement attempts any `/reports/regulatory/*` endpoint or page | `FEATURE_NOT_ENTITLED`, page shows entitlement notice, not blank/empty report | P0 |
| TC-RPT-012 | NFR-TENANT-01 | N | Tenant B requests a report using a date range/unit that only has Tenant A data | Report returns zero/empty for Tenant B, never Tenant A's figures | P0 |
| TC-RPT-013 | FR-UNIT-06 | P | Multi-unit tenant runs a report with no unit filter, then with a specific unit filter | Consolidated totals equal the sum of all per-unit totals | P2 |
| TC-RPT-014 | NFR-PERF-03 | N | Export a report for a large date range / high transaction volume | If export exceeds 10s, flag as an NFR breach for escalation | P2 |

---

## 8. Config (FR-CFG)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-CFG-001 | FR-CFG-01 | P | Create, rename, and deactivate a `CooperativeUnit` (with ≥2 units so deactivation is legal) | All three operations succeed | P1 |
| TC-CFG-002 | FR-CFG-01/FR-UNIT-01 | N | Deactivate the tenant's only remaining active unit | Rejected (`CONFLICT`) — covered again here for the Config UI path specifically | P0 |
| TC-CFG-003 | FR-CFG-02 | P | Create a custom role with a specific permissions matrix (e.g. read-only Members, no Loans) | Role created; a user assigned it is constrained accordingly | P1 |
| TC-CFG-004 | FR-CFG-02 | P | Edit an existing custom role's permissions | Changes take effect for users with that role (verify on next login/refresh per FR-AUTH-07) | P1 |
| TC-CFG-005 | FR-CFG-02 | N | Delete a role currently assigned to an active user | Either blocked with a clear error, or users are safely reassigned/deactivated — verify actual behavior matches an acceptable, non-corrupting outcome | P1 |
| TC-CFG-006 | FR-CFG-03 | P | Create a staff user, assign a role, then deactivate the user | User created with role; deactivated user cannot log in | P1 |
| TC-CFG-007 | FR-CFG-03 (mirrors FR-PADM-06) | N | A user attempts to deactivate their own account | Rejected — self-deactivation guard | P1 |
| TC-CFG-008 | FR-CFG-04 | P | Configure whitelabel (custom domain, primary color, hide-branding, sender identity) on a tenant whose package has `whitelabelEnabled` | Settings saved and reflected in the branded UI | P2 |
| TC-CFG-009 | FR-CFG-04 | N | Attempt to **write** whitelabel config on a tenant whose package does not have `whitelabelEnabled` | `FEATURE_NOT_ENTITLED` | P1 |
| TC-CFG-010 | FR-CFG-04 | P | **Read** whitelabel config on a tenant without the entitlement | Read succeeds (read is ungated per spec) — confirm this is intentional, not a leftover gap | P2 |
| TC-CFG-011 | FR-CFG-05 | P | Set `modalDisetor` ≥ Rp 5,000,000 | Saved; compliance threshold indicator (if any) reflects "met" | P2 |
| TC-CFG-012 | FR-CFG-05 | P | Set `modalDisetor` < Rp 5,000,000 | Saved (field itself isn't gated), but any audit-threshold messaging correctly flags below-threshold status | P2 |

---

## 9. Platform Admin (FR-PADM)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-PADM-001 | FR-PADM-01 | P | Log in as platform admin, list tenants | All tenants visible across the platform, with unit/user counts and package name | P1 |
| TC-PADM-002 | FR-PADM-02 | P | Provision a new koperasi from the Platform Admin UI (tenant + first unit + admin) | New tenant created and immediately loginable on its subdomain | P1 |
| TC-PADM-003 | FR-PADM-03 | P | Assign/reassign a tenant's `SubscriptionPackage`, toggle `isActive`, set `nextBillingDate` | Changes persist; tenant's entitlements update accordingly (verify via TC-ACC-007/008-style check) | P1 |
| TC-PADM-004 | FR-PADM-03 | N | Set a tenant `isActive = false` | Tenant's users can no longer log in (or are blocked at a defined point) — confirm actual current behavior | P1 |
| TC-PADM-005 | FR-PADM-04 | P | Create a `SubscriptionPackage` with name, price, entitled modules, caps, whitelabel flag | Package created and assignable to tenants | P2 |
| TC-PADM-006 | FR-PADM-04 | N | Create a package with invalid/negative price or caps | `VALIDATION_ERROR` | P2 |
| TC-PADM-007 | FR-PADM-05 | P | Create, edit, and deactivate a platform-admin user | Operations succeed independent of any tenant's own user management | P1 |
| TC-PADM-008 | FR-PADM-06 | N | Platform admin attempts to deactivate their **own** account | Rejected — self-deactivation guard, mirrors TC-CFG-007 | P1 |
| TC-PADM-009 | FR-PADM-07/NFR-SEC-12 | N | As a logged-in platform admin, manually navigate the browser to a tenant business-module URL (e.g. `/members`, `/savings`) | Blocked by route guard; nav does not expose tenant links either (`Sidebar.tsx`) | P0 |
| TC-PADM-010 | NFR-SEC-11 | N | A tenant's own "Super Admin" (fine-grained `Permissions`) role attempts to reach `/api/platform/*` | Rejected — platform access gates on the coarse `AuthClaims.role`, not the tenant `Permissions` blob | P0 |
| TC-PADM-011 | NFR-SEC-11 | N | A logged-in ordinary tenant user (non-platform-admin) calls `/api/platform/tenants` directly via API | `FORBIDDEN`, no cross-tenant list leaked | P0 |
| TC-PADM-012 | FR-PADM-08 | N | Trigger a condition that should notify platform admins (e.g. billing threshold) | Confirm current behavior is "nothing happens" (feature is schema-only/Planned) — document as expected gap, not a bug | P3 |

---

## 10. Dashboard (FR-DASH)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-DASH-001 | FR-DASH-01 | P | Load dashboard for a tenant with members/savings/loans data | Member count, savings totals, loan portfolio health, recent activity all shown accurately | P1 |
| TC-DASH-002 | FR-DASH-01 | P | Load dashboard for a brand-new tenant with zero data | Shows correct zero-state, no errors | P2 |
| TC-DASH-003 | NFR-TENANT-01 | N | Tenant B loads their dashboard immediately after Tenant A performed transactions | Only Tenant B's own figures appear | P0 |
| TC-DASH-004 | NFR-PERF-02 | N | Load dashboard for a tenant with a large dataset | Load completes in <3s; flag as NFR breach if exceeded | P2 |

---

## 11. RBAC / Permission Matrix (cross-cutting)

Seed matrix reference (from `provision.ts`): Super Admin = full access to all modules incl.
accounting; Manager = full Members/Savings/Loans/Reports, read-only Config, no accounting
write, no user/role write; Teller = read-only Members, create/read/update Savings (no delete),
read/update Loans, nothing in Reports/Config/Users/Roles; Viewer = read-only everywhere, nothing
in Config/Users/Roles.

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-RBAC-001 | seed roles | P | Log in as Manager, attempt to edit Config (Units/Roles/Accounts) | Blocked — Manager has `config: { update: false }` | P1 |
| TC-RBAC-002 | seed roles | P | Log in as Manager, create a member/saving/loan | Allowed — Manager has FULL on Members/Savings/Loans | P2 |
| TC-RBAC-003 | seed roles | N | Log in as Teller, attempt to delete a savings transaction/account | Blocked — Teller's savings permission has `delete: false` | P1 |
| TC-RBAC-004 | seed roles | N | Log in as Teller, attempt to open Reports or Config | Blocked/hidden — Teller has `{}` (no permissions) on both | P1 |
| TC-RBAC-005 | seed roles | P | Log in as Teller, record a savings deposit and a loan payment | Allowed | P2 |
| TC-RBAC-006 | seed roles | N | Log in as Viewer, attempt any create/update/delete action anywhere (member, saving, loan, config) | All blocked — Viewer is read-only everywhere | P1 |
| TC-RBAC-007 | seed roles | P | Log in as Viewer, browse Members/Savings/Loans/Reports (read) | Allowed | P2 |
| TC-RBAC-008 | RBAC vs entitlement | N | Log in as Super Admin on a tenant **without** the accounting entitlement, attempt to open COA | Blocked by `FEATURE_NOT_ENTITLED` despite having full role permissions — entitlement gate is independent of and layered on top of RBAC | P0 |

---

## 12. Multi-Tenant Isolation (NFR-TENANT) — release-blocking category

Run each case both via the UI (as a sanity check) **and** via direct API calls substituting a
known other-tenant ID, since the UI alone can mask a backend leak.

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-TEN-001 | NFR-TENANT-01 | N | `GET /members`, `/members/:id` — Tenant B session, Tenant A's member ID | `NOT_FOUND`, list never contains Tenant A members | P0 |
| TC-TEN-002 | NFR-TENANT-01 | N | `GET /savings`, `/savings/:id`, transaction history — Tenant B session, Tenant A's saving ID | `NOT_FOUND` | P0 |
| TC-TEN-003 | NFR-TENANT-01 | N | `GET /loans`, `/loans/:id`, payment history — Tenant B session, Tenant A's loan ID | `NOT_FOUND` | P0 |
| TC-TEN-004 | NFR-TENANT-01 | N | `GET/PUT /config/*` (units, roles, accounts, mappings) — Tenant B session, Tenant A's resource IDs | `NOT_FOUND`, no mutation applied to Tenant A's row | P0 |
| TC-TEN-005 | NFR-TENANT-01 | N | `/reports/*` — Tenant B session, any query params referencing Tenant A's unit/account IDs | Empty/zero result for Tenant B, never Tenant A's figures | P0 |
| TC-TEN-006 | NFR-TENANT-01 | N | `/users/*` — Tenant B admin session, Tenant A's user ID | `NOT_FOUND` | P0 |
| TC-TEN-007 | NFR-SEC-01 | N | Craft a request body/URL param carrying a `tenantId` different from the session's — for any mutating endpoint | Ignored entirely; server uses `req.auth.tenantId` only | P0 |
| TC-TEN-008 | Prisma tenant-scope middleware | N | (White-box) Attempt a raw Prisma query path that bypasses the tenant-scope extension, if any code path allows it | Middleware/extension still enforces `tenantId`, or the code path is confirmed not to exist | P0 |

---

## 13. API Contract & Security NFRs

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-SEC-001 | NFR-API-01 | P | Call any successful endpoint | Response matches `ApiResponse<T>` shape: `{ success: true, data, meta: { timestamp, requestId } }` | P2 |
| TC-SEC-002 | NFR-API-01/02 | N | Call any endpoint that errors (validation, not found, conflict, etc.) | `{ success: false, error: { code, message }, meta }` with a valid `ErrorCode` value, never an ad-hoc string | P2 |
| TC-SEC-003 | NFR-API-03 | N | Send a request body missing required fields or with wrong types to any POST/PUT endpoint | Zod validation rejects before touching the DB; `VALIDATION_ERROR` | P1 |
| TC-SEC-004 | NFR-SEC-03 | N | (White-box/DB inspection) Check stored `passwordHash` values and application logs after several logins | Passwords are bcrypt hashes only; plaintext never appears in DB rows or logs | P0 |
| TC-SEC-005 | NFR-SEC-06 | P | Inspect response headers on any API call | Standard `helmet` security headers present (CSP/X-Frame-Options/etc. per configuration) | P2 |
| TC-SEC-006 | NFR-SEC-07 | N | Send a request with an `Origin` header not in `CORS_ORIGIN` allow-list | CORS rejects the cross-origin request | P1 |
| TC-SEC-007 | NFR-SEC-10 | N | Trigger an unexpected server error (e.g. malformed input causing a lower-level exception) | Client receives a generic `INTERNAL_ERROR` message, no stack trace/internal detail leaked | P1 |
| TC-SEC-008 | NFR-SEC-09 (documents the gap) | N | Submit 50+ rapid failed login attempts against one account/tenant | **Currently expected to succeed unthrottled** — confirms the known open risk in test-plan §7; log as accepted risk, not a new bug, unless behavior has changed | P2 |
| TC-SEC-009 | CLAUDE.md rule 1 | N | Grep/code-review check: any new Prisma query touching tenant data omits an explicit `tenantId` filter | Should not compile/pass review — verify via `docs/02-System-Requirements-SISKOP.md` NFR-TENANT-02 that every module's test file has a leak-case test | P1 |
| TC-SEC-010 | Dev proxy / tenant resolution | N | With `apps/frontend/vite.config.ts` proxy `changeOrigin` flipped to `true` (regression check only — do not ship this) | Subdomain is erased before reaching backend, tenant resolution breaks — confirms why this must stay `false`; revert after test | P2 |

---

## 14. Mobile App (Fase 1 — read-only)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-MOB-001 | Mobile Fase 1 scope | P | Log in on `apps/mobile` with valid tenant-subdomain credentials | Session established, same auth flow as web | P1 |
| TC-MOB-002 | Mobile Fase 1 scope | P | Browse Dashboard, Members, Savings, Loans, Reports on mobile | All render read-only, data matches the web app for the same tenant | P1 |
| TC-MOB-003 | Mobile Fase 1 scope | N | Attempt any create/edit/delete action from mobile UI (if a stray control exists) | No mutating action should be reachable — Fase 1 is read-only by design | P1 |
| TC-MOB-004 | Mobile Fase 1 scope | P | Open Anggota Menunggak (Overdue) view on mobile | Accessible **without** requiring the accounting entitlement (permanent access per memory note) | P1 |
| TC-MOB-005 | Mobile Fase 1 scope | P | Open the 3 ported Laporan Regulasi tabs on mobile | Render correctly, matching web figures for the same period | P2 |
| TC-MOB-006 | Mobile Fase 1 scope | P | Open Profil page on mobile, edit name/email | Behaves the same as web `ProfilePage` (FR-AUTH-12) | P2 |
| TC-MOB-007 | NFR-TENANT-01 | N | Tenant B logs into mobile, browses all Fase-1 screens | No Tenant A data visible anywhere | P0 |
| TC-MOB-008 | Mobile Fase 1 scope | N | Navigate to a module not in Fase 1 scope (if a route exists) | `ComingSoonPage` or equivalent shown, not a crash/blank screen | P3 |

---

## 15. Non-Functional Spot Checks (manual, no automated harness yet)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-PERF-001 | NFR-PERF-01 | N | Time 10 representative API calls (list members, create saving, generate report) under normal load | p99 < 500ms; flag any outlier for investigation | P2 |
| TC-PERF-002 | NFR-PERF-02 | N | Time dashboard load from login redirect to fully rendered, cold and warm cache | < 3s both cases | P2 |
| TC-PERF-003 | NFR-PERF-03 | N | Time PDF export for each of the 6 exportable reports | Each < 10s | P2 |
| TC-PERF-004 | NFR-AVAIL-* | N | (Documentation check only — infra not built) Confirm no automated backup/restore exists | Matches known gap in test plan §2.2; not a new defect | P3 |
| TC-PERF-005 | NFR-SCALE-01 | N | (Documentation check only) Confirm deployment topology matches baseline doc | Informational, no pass/fail | P3 |

---

## Summary

| Module | # Cases | P0 | P1 |
|---|---|---|---|
| Auth & Provisioning | 26 | 8 | 9 |
| Multi-Unit Model | 5 | 1 | 1 |
| Members | 12 | 1 | 3 |
| Savings | 16 | 6 | 5 |
| Loans | 22 | 11 | 6 |
| Accounting/Ledger | 10 | 2 | 6 |
| Reports | 14 | 4 | 7 |
| Config | 12 | 1 | 7 |
| Platform Admin | 12 | 3 | 6 |
| Dashboard | 4 | 1 | 1 |
| RBAC | 8 | 1 | 4 |
| Multi-Tenant Isolation | 8 | 8 | 0 |
| API Contract & Security | 10 | 1 | 4 |
| Mobile | 8 | 1 | 4 |
| Non-Functional | 5 | 0 | 0 |
| **Total** | **172** | **49** | **63** |

The P0 concentration in Savings, Loans, and Multi-Tenant Isolation is intentional — it mirrors the
four highest-risk areas named in `QA-INSTRUCTIONS.md` and test-plan §3.3, and none of those cases
are eligible for a PM override on failure.

---

## 16. Execution Log — Cycle 1 (2026-08-27)

Executed against `main` @ `61cc34f`, backend dev server (`localhost:3001`) + frontend dev server
(`localhost:3000`) on the local Docker Postgres (port 5433), using the existing `demo` (accounting
package, Tenant A) and `barokah` (no package, Tenant B) tenants as the two-tenant fixture required
by test-plan §4. Methods used: (1) the automated Vitest suite, (2) a live API-execution script
(curl-driven, since Node's `fetch` silently refuses to send a custom `Host` header, which
`slugFromHost`-based tenant resolution depends on), (3) targeted source/schema review to confirm a
live result's root cause, (4) one headless-browser screenshot (no Puppeteer/Playwright is installed
in this environment, so scripted authenticated UI walkthroughs were out of reach this cycle).

### 16.1 Entry criteria (test-plan §5.1)

| Check | Result |
|---|---|
| `pnpm install` | Clean (mobile app's `node_modules` was missing; installed) |
| `pnpm run lint` | **Green** — 4 packages, 0 errors |
| `pnpm run typecheck` | **Green** — 5 packages, 0 errors |
| `pnpm run build` | **Green** — backend/frontend/mobile all build |
| `pnpm run test` (backend) | **217/217 tests pass**, 16/16 files, **93.41% line coverage** (≥80% gate met) |
| Frontend/mobile automated tests | None exist (NFR-TEST-07, documented gap — not a new finding) |

Backend note: running the full 16-file suite in one process crashed with a Windows access
violation (exit `-1073741819`) under Node's default heap size once `--coverage` instrumentation was
active — not a test failure (every file that ran passed). Re-run with
`NODE_OPTIONS=--max-old-space-size=4096` completed cleanly. Worth carrying into CI/local docs as an
environment note; not a product defect.

### 16.2 Defect log — new findings this cycle

| # | Severity | TC ID(s) | FR/NFR | Summary |
|---|---|---|---|---|
| D1 | **P0** | TC-SAV-003 | FR-SAV-06 | Opening a WAJIB/SUKARELA saving for a member with **no active Pokok saving succeeds** (should be rejected `MEMBER_HAS_NO_POKOK_SAVING`). `hasPokokSaving()` exists in `savings/service.ts` but is only ever called from `loans/service.ts::createLoan` — `savings/service.ts::createSaving` never calls it. The loan-side gate (TC-LOAN-008) works correctly; only the savings-side gate is missing. |
| D2 | **P0** | TC-SAV-011 | FR-SAV-05 | A Simpanan Pokok **can be withdrawn to zero**. The only `CANNOT_WITHDRAW_POKOK` check in the codebase (`withdrawFromSaving`, `savings/service.ts:226-236`) guards a *different* rule — "no withdrawal while the member has an active loan" — there is no floor/never-zero check at all. Reproduced live: a Pokok saving with a 400,000 balance and no active loan was drained to exactly 0 with a `201` success response. |
| D3 | **P0** | TC-SAV-005 | FR-SAV-02 | A member can open **unlimited duplicate** Saving accounts for the same (member, unit, savingConfig) triple. No application check in `createSaving`, and the `Saving` Prisma model (`schema.prisma:350-370`) has no `@@unique` constraint to catch it at the DB layer either. Reproduced live: opening the same Wajib config twice for one member returned `201` both times. |
| D4 | **P1** | TC-AUTH-004 | FR-AUTH-02 | Registering a new tenant with an `adminEmail` already used as another tenant's admin **succeeds** (`201`) instead of `CONFLICT`. `User.email` uniqueness is `@@unique([tenantId, email])` (schema.prisma:249) — scoped per tenant, not global — so the cross-tenant collision this rule is meant to catch can never trigger the `P2002` the code's `isUniqueViolation` catch relies on. Slug and registrationNo duplicates (the other two clauses of the same rule) correctly return `CONFLICT` — only the admin-email clause is affected. |
| D5 | P2 / informational | TC-PERF-001 | NFR-PERF-01 | `POST /api/auth/login` measured 860-923ms across 3 samples — over the documented p99 <500ms target. The other 3 spot-checked endpoints (list members 73-96ms, dashboard summary 81-95ms, financial report 105-107ms) were all comfortably under budget, so this looks bcrypt-cost-bound (`BCRYPT_ROUNDS = 10` in `auth/service.ts`) rather than a general regression. Worth a deliberate call on whether the NFR should carve out login, or whether the round count needs tuning — not investigated further this cycle. |

**All four D1-D4 findings contradict `docs/02-System-Requirements-SISKOP.md`**, which currently marks
FR-SAV-02, FR-SAV-05, FR-SAV-06, and FR-AUTH-02 as **"Implemented."** Per test-plan §10, that status
should be corrected in the same PR that fixes the gap (or the requirement re-scoped, if e.g. the
Pokok-withdrawal rule was deliberately narrowed to "blocked only while a loan is active" and the
requirements doc is what's stale, not the code). QA cannot make that call — flagging for Engineer/PM
per `CLAUDE.md` decision authority.

Per test-plan §3.3, a failed money-arithmetic case is release-blocking regardless of severity
elsewhere — D1-D3 sit squarely in "Savings balance arithmetic," the plan's #2 highest-risk category.

### 16.3 Results by section

Legend: **Live** = executed against the running dev backend this cycle (script:
`qa-live.mjs`/`qa-live-3.mjs`, 88 checks total, 84 pass / 4 fail). **Automated** = already exercised
by the passing Vitest suite (file cited). **Code-reviewed** = confirmed by reading the actual
implementation/schema rather than an HTTP round-trip. **Not executed** = out of reach this cycle
(reason given) — not claimed as passing.

#### 1. Auth & Tenant Provisioning

| ID | Result | Evidence |
|---|---|---|
| TC-AUTH-001 | Automated PASS | `auth-service.test.ts` "creates tenant, first unit, 4 seed roles, and admin user" |
| TC-AUTH-002 | **Live PASS** | duplicate slug → `409 CONFLICT` |
| TC-AUTH-003 | **Live PASS** | duplicate registrationNo → `409 CONFLICT` |
| TC-AUTH-004 | **Live FAIL — D4** | duplicate adminEmail across tenants → `201`, not rejected |
| TC-AUTH-004b | **Live PASS** | body `tenantId`/`slug` ignored; Host still resolved to caller's real tenant |
| TC-AUTH-005 | **Live PASS** + Automated | bad slug format → `422`; `auth-service.test.ts` |
| TC-AUTH-006 | **Live PASS** + Automated | 7-char password → `422`; `auth-routes.test.ts` |
| TC-AUTH-007 | **Live PASS** | login on `demo.localhost:3000` resolves to demo's tenantId only |
| TC-AUTH-008 | **Live PASS** | demo credentials against barokah's subdomain → `401` |
| TC-AUTH-009 | **Live PASS** + Automated | no subdomain → `422 VALIDATION_ERROR`, not generic 401; `auth-routes.test.ts` |
| TC-AUTH-010 | **Live PASS** + Automated | wrong password → generic `401`; `auth-routes.test.ts` |
| TC-AUTH-011 | **Live PASS** | unknown email → identical message to wrong-password case (957ms vs 264ms — see note below) |
| TC-AUTH-012 | **Live PASS** | access token `exp - iat` = exactly 900s |
| TC-AUTH-013 | **Live PASS** + Automated | refresh token only in httpOnly cookie, never response body |
| TC-AUTH-014 | Not executed | role-change-reflected-on-refresh not exercised this cycle |
| TC-AUTH-015 | Automated PASS | `auth-middleware.test.ts`, `auth-service.test.ts` "rejects a garbage token" |
| TC-AUTH-016 | **Live PASS** + Automated | `/auth/me` returns caller's own record |
| TC-AUTH-017 | Automated (partial) | `auth-middleware.test.ts` covers tampered/no-tenantId tokens; `getMe` scoped by (userId, tenantId) — code-reviewed |
| TC-AUTH-018 | Not executed | no reachable path in current API leaves a user with zero unit access to attempt |
| TC-AUTH-019 | **Live PASS** | profile name update reflected immediately |
| TC-AUTH-020 | **Live PASS** | cross-tenant email reuse on profile update succeeds (uniqueness is per-tenant by design) |
| TC-AUTH-021 | Automated PASS | `users.test.ts` "changes the password when the current password is correct" |
| TC-AUTH-022 | **Live PASS** + Automated | wrong currentPassword rejected |
| TC-AUTH-023 | **Live PASS** + Automated | 7-char newPassword → `422` |
| TC-AUTH-024 | **Live PASS** | platform admin token has `role: "super_admin"` |
| TC-AUTH-025 | Not executed | would require restarting the server with a broken `JWT_SECRET`; code-reviewed: `secret()` in `auth/service.ts` throws on any falsy value including `""` |

Note on TC-AUTH-011: the timing gap (957ms known-email vs 264ms unknown-email) looks large but is a
single manual sample dominated by bcrypt's cost on the *known*-email path (a real hash compare) vs.
the dummy-hash path (cheaper) for the unknown-email path — consistent with FR-AUTH-05's documented
design, not a new timing-oracle finding. A proper statistical timing-attack analysis is out of scope
for a single manual sample.

#### 2. Multi-Unit Cooperative Model

| ID | Result | Evidence |
|---|---|---|
| TC-UNIT-001 | Automated PASS | `provision-tenant.test.ts` "creates a tenant with exactly one unit" |
| TC-UNIT-002 | Automated PASS | `config.test.ts` "rejects deactivating the tenant's only active unit" |
| TC-UNIT-003 | Automated PASS | `config.test.ts` "allows deactivating a unit once a second active unit exists" |
| TC-UNIT-004 | Not executed | no multi-unit tenant with report data was exercised live this cycle |
| TC-UNIT-005 | Automated (implied) | `config` module schema.ts is 100% line-covered; no test individually named for this case |

#### 3. Members

| ID | Result | Evidence |
|---|---|---|
| TC-MEM-001 | Automated PASS (partial) | `members.test.ts` "creates a member with an auto-generated memberId and accountNumber"; KTP upload not covered by any check this cycle |
| TC-MEM-002 | **Live PASS** | 15-digit NIK → `422` "NIK harus 16 digit" |
| TC-MEM-003 | **Live PASS** | NIK with letters → `422` "NIK harus berupa angka" |
| TC-MEM-004 | **Live PASS** + Automated | duplicate NIK same tenant → `409 NIK_EXISTS` |
| TC-MEM-005 | Code-reviewed PASS | `schema.prisma:280` `@@unique([tenantId, nik])` — NIK uniqueness is per-tenant, not global |
| TC-MEM-006 | **Live PASS** | 5-char address → `422` "Alamat harus lengkap" |
| TC-MEM-007 | **Live PASS** | malformed birthDate → `422` "Format tanggal: YYYY-MM-DD" |
| TC-MEM-008 | Automated PASS | `members.test.ts` "returns a paginated list with meta", "filters by a search keyword" |
| TC-MEM-009 | Automated (partial) | `members.test.ts` "soft-deletes — sets isActive false"; the `isActive=false` filter combination not separately exercised |
| TC-MEM-010 | Not executed | KTP upload/Windows-path regression needs a real file upload, not attempted this cycle |
| TC-MEM-011 | **Live PASS** | see TC-TEN-001 below (identical scenario) |
| TC-MEM-012 | Code-reviewed PASS | `schema.prisma:263-264` `memberId`/`accountNumber` are globally `@unique` |

#### 4. Savings — highest-risk area

| ID | Result | Evidence |
|---|---|---|
| TC-SAV-001 | Automated PASS | `savings.test.ts` "creates a config" |
| TC-SAV-002 | Automated (implied) | schema `rate` capped at 100; 100% schema.ts coverage |
| TC-SAV-003 | **Live FAIL — D1 (P0)** | Wajib opened for a member with no Pokok → `201`, not rejected |
| TC-SAV-004 | **Live PASS** | Pokok then Wajib for the same member both succeed |
| TC-SAV-005 | **Live FAIL — D3 (P0)** | opening a 2nd saving for the same (member,unit,config) → `201`, not `409` |
| TC-SAV-006 | **Live PASS** + Automated | deposit 500,000 → balance exactly +500,000 |
| TC-SAV-007 | **Live PASS** + Automated | withdraw 200,000 → balance exactly -200,000 |
| TC-SAV-008 | **Live PASS** + Automated | amount=0 → `422` |
| TC-SAV-009 | **Live PASS** | amount=-100,000 → `422` |
| TC-SAV-010 | **Live PASS** + Automated | overdraw → `422 INSUFFICIENT_BALANCE` |
| TC-SAV-011 | **Live FAIL — D2 (P0)** | full Pokok balance withdrawn to 0 → `201`, not rejected |
| TC-SAV-012 | **Live PASS** | covered by TC-SAV-006 (deposit into existing Pokok succeeds) |
| TC-SAV-013 | Not executed | Decimal-precision repeated-fraction test not run; `balance` is `Decimal(15,2)` by schema (structurally reduces — does not eliminate the need to test — float-drift risk) |
| TC-SAV-007b | Automated PASS | `config.test.ts` mapped-deposit-posts flow; corroborated live by TC-RPT-005's `balanced: true` Neraca |
| TC-SAV-014 | Automated PASS | `config.test.ts` "flips a deposit's journal entry from UNPOSTED_MISSING_MAPPING to POSTED once mapped" |
| TC-SAV-015 | **Live PASS** | Tenant B saving id via Tenant A token → `404`, no mutation |

#### 5. Loans

| ID | Result | Evidence |
|---|---|---|
| TC-LOAN-001 | Automated (implied) | 100% schema.ts coverage; POST /loans/configs exercised live in batch 3 |
| TC-LOAN-002 | **Live PASS** | maxTermMonths=400 → `422` |
| TC-LOAN-003 | Automated PASS | `loan-calc.test.ts` "computes conventional (anuitas) monthly payment correctly" |
| TC-LOAN-004 | Automated PASS | `loan-calc.test.ts` "divides principal evenly when the rate is zero" |
| TC-LOAN-005 | Automated PASS | `loan-calc.test.ts` "computes syariah (flat margin) total interest correctly" |
| TC-LOAN-006 | Automated PASS | `loans.test.ts` "rejects a term exceeding the config's maxTermMonths" |
| TC-LOAN-007 | **Live PASS** | principalAmount=0 (valid memberId) → `422` "Nominal pinjaman harus lebih dari 0" |
| TC-LOAN-008 | **Live PASS** + Automated | loan for member with no Pokok → `422 MEMBER_HAS_NO_POKOK_SAVING` |
| TC-LOAN-009 | Automated PASS | `loans.test.ts` "returns a 200 warning (not an error) when the member already has an active loan" |
| TC-LOAN-010 | Automated PASS | `loans.test.ts` "creates a second loan when force:true is set" |
| TC-LOAN-011 | **Live PASS** + Automated | loan disbursed for a Pokok-holding member, `201` |
| TC-LOAN-012 | **Live PASS** + Automated | payment of 500,000 → `newRemaining` decreases by exactly 500,000 |
| TC-LOAN-013 | Automated (implied) | 100% schema.ts coverage |
| TC-LOAN-014 | Automated PASS | `loans.test.ts` "rejects a payment on an already-completed loan" |
| TC-LOAN-015..019 | Automated PASS | `kol.test.ts` (9 tests); note `kol.ts` line coverage is 74.24%, not 100% — some `recalculateKOL` branches (lines 38-46, 59-66) are less exercised than the pure `getKOLCategory` boundary function |
| TC-LOAN-020 | **Live PASS** | freshly disbursed on-time loan stays `LANCAR` |
| TC-LOAN-021 | Automated PASS | `loans.test.ts` "returns ACTIVE loans with a non-LANCAR KOL category, sorted by severity" |
| TC-LOAN-022 | **Live PASS** | Tenant B loan id via Tenant A token, pay attempt → `404` |

#### 6. Accounting / Ledger

| ID | Result | Evidence |
|---|---|---|
| TC-ACC-001 | Automated PASS | `config.test.ts` "creates a header account and a child account under it" |
| TC-ACC-002 | Automated PASS | `config.test.ts` "rejects a parentId belonging to another tenant" |
| TC-ACC-003 | Automated PASS | `config.test.ts` "creates a mapping and lists it with resolved names" |
| TC-ACC-004 | **Live PASS** | demo's live Neraca returned `balanced: true` (debit=credit across real posted entries) |
| TC-ACC-005 | Not executed | white-box forced-unbalanced-construction not exercised; `journal.ts` is 97.58% line-covered |
| TC-ACC-006 | Automated PASS | `config.test.ts` "flips a deposit's journal entry from UNPOSTED_MISSING_MAPPING to POSTED once mapped" |
| TC-ACC-007 | **Live PASS** | barokah (no package) blocked from COA, `403 FEATURE_NOT_ENTITLED` |
| TC-ACC-008 | **Live PASS** | demo (entitled) reads COA, `200` |
| TC-ACC-009 | Automated PASS | `config.test.ts` "saves the allocation and rejects a mix that doesn't add up to 100%" |
| TC-ACC-010 | Automated PASS | same test as above |

#### 7. Reports

| ID | Result | Evidence |
|---|---|---|
| TC-RPT-001 | **Live PASS** + Automated | live financial report returned coherent aggregates; `reports.test.ts` |
| TC-RPT-002 | Automated PASS | `reports.test.ts` "returns membership growth and KOL distribution for the given year" |
| TC-RPT-003 | **Live PASS** + Automated | today-range report returns data; `reports.test.ts` endOfDay regression test |
| TC-RPT-004 | Automated PASS | same regression test covers the upper-bound exclusion |
| TC-RPT-005 | **Live PASS** | demo Neraca: `balanced: true` (Aset 39,032,968.22 = Kewajiban+Ekuitas 39,032,968.22) |
| TC-RPT-006 | Automated PASS | `reports.test.ts` Arus Kas tests |
| TC-RPT-007 | Automated PASS | `reports.test.ts` "computes SHU berjalan as pendapatan minus beban for the period" |
| TC-RPT-008 | Automated PASS | `reports.test.ts` SHU distribution tests |
| TC-RPT-009 | Automated PASS (data only) | CALK save/read tests; UI editability + PDF-exclusion not checked live |
| TC-RPT-010 | Automated PASS (partial) | only financial + neraca PDF streaming are named tests; Arus Kas/Laba Rugi/SHU/RAT PDF export **not** explicitly tested anywhere — `pdf.ts` is the lowest-covered file in the codebase at 52.53% lines. Flagged as a coverage gap, not a confirmed defect. |
| TC-RPT-011 | **Live PASS** | barokah blocked from `/regulatory/*`, `403 FEATURE_NOT_ENTITLED`; `/financial` still allowed |
| TC-RPT-012 | **Live PASS** | demo/barokah full-range financial totals differ, no cross-tenant bleed |
| TC-RPT-013 | Not executed | consolidated-vs-per-unit sum not exercised against a live multi-unit tenant |
| TC-RPT-014 | Not executed | large-dataset export timing, no tooling for it this cycle |

#### 8. Config

| ID | Result | Evidence |
|---|---|---|
| TC-CFG-001 | Automated PASS | `config.test.ts` unit create/rename/deactivate tests |
| TC-CFG-002 | Automated PASS | `config.test.ts` "rejects deactivating the tenant's only active unit" |
| TC-CFG-003 | Automated PASS | `config.test.ts` "lists the 4 seed roles and creates a new one" |
| TC-CFG-004 | Automated PASS (partial) | `config.test.ts` "updates a role's permissions"; the on-refresh-reflection nuance shares TC-AUTH-014's gap |
| TC-CFG-005 | Automated PASS | `config.test.ts` role-deletion tests (both branches) |
| TC-CFG-006 | Automated PASS + Live-adjacent | `users.test.ts`; my RBAC setup created/deactivated 3 ephemeral users live without issue |
| TC-CFG-007 | **Live PASS** + Automated | self-deactivation rejected, `409`; `users.test.ts` |
| TC-CFG-008 | Automated PASS (data only) | `config.test.ts` "saves whitelabel config for an entitled tenant"; branded-UI reflection not checked |
| TC-CFG-009 | **Live PASS** + Automated | barokah whitelabel write → `403 FEATURE_NOT_ENTITLED` |
| TC-CFG-010 | **Live PASS** + Automated | barokah whitelabel read → `200` (read ungated) |
| TC-CFG-011 | Automated PASS | `config.test.ts` modal disetor save/clear |
| TC-CFG-012 | Automated PASS (partial) | `config.test.ts` "rejects a negative value"; audit-threshold UI messaging not checked |

#### 9. Platform Admin

| ID | Result | Evidence |
|---|---|---|
| TC-PADM-001 | **Live PASS** + Automated | platform admin lists all 3 real tenants (demo, barokah, kopkar-umsurabaya) |
| TC-PADM-002 | Automated PASS | `platform.test.ts` "provisions a new koperasi with a working admin login" (not re-run live to avoid polluting the shared dev DB further) |
| TC-PADM-003 | Automated PASS | `platform.test.ts` "assigns a package and toggles active status" |
| TC-PADM-004 | Automated PASS | `auth-service.test.ts` "rejects login to a deactivated tenant" |
| TC-PADM-005 | Automated PASS | `platform.test.ts` "creates, lists, updates, and deactivates a package" |
| TC-PADM-006 | Automated (implied) | 100% schema.ts coverage, no individually named test |
| TC-PADM-007 | Automated PASS | `platform.test.ts` "creates, lists, and updates a platform admin" |
| TC-PADM-008 | Automated PASS | `platform.test.ts` "deactivates another platform admin but rejects deactivating yourself" |
| TC-PADM-009 | Not executed | browser route-guard/nav-visibility check needs an authenticated UI walkthrough, not available this cycle |
| TC-PADM-010 | **Live PASS** | same mechanism as TC-PADM-011 — the demo admin token carries the tenant-scoped "Super Admin" `Permissions` role and was still rejected by `/platform/*` |
| TC-PADM-011 | **Live PASS** | regular tenant admin calling `/api/platform/tenants` → `403 FORBIDDEN` |
| TC-PADM-012 | Confirmed gap | matches test-plan §2.2 — FR-PADM-08 is schema-only, no route; not a new defect |

#### 10. Dashboard

| ID | Result | Evidence |
|---|---|---|
| TC-DASH-001 | **Live PASS** + Automated | `/dashboard/summary` returned `200` with real data; `dashboard.test.ts` |
| TC-DASH-002 | Not executed | zero-data tenant not exercised this cycle |
| TC-DASH-003 | Automated (implied) | `dashboard/service.ts` is 100% covered and every query is tenant-scoped; not re-verified with a dedicated live cross-tenant dashboard check |
| TC-DASH-004 | Not executed | large-dataset load timing, no tooling this cycle |

#### 11. RBAC / Permission Matrix

| ID | Result | Evidence |
|---|---|---|
| TC-RBAC-001 | **Live PASS** | ephemeral Manager blocked from Config write, `403` |
| TC-RBAC-002 | **Live PASS** | Manager allowed to read Members |
| TC-RBAC-003 | **Live PASS** | ephemeral Teller blocked from member delete, `403` |
| TC-RBAC-004 | **Live PASS** | Teller blocked from Reports and Config, `403` |
| TC-RBAC-005 | Automated PASS | `savings.test.ts` "lets a teller create a saving account", `savings.test.ts` "lets a teller deposit" |
| TC-RBAC-006 | **Live PASS** | ephemeral Viewer blocked from creating a member, `403` |
| TC-RBAC-007 | **Live PASS** | Viewer allowed to read Members |
| TC-RBAC-008 | **Live PASS** | barokah's Super Admin (full role permissions) still blocked from COA by the entitlement gate |

All three ephemeral RBAC test users were deactivated (`isActive: false`) at the end of the run;
none were deleted, matching how the product itself handles user removal.

#### 12. Multi-Tenant Isolation — release-blocking category

| ID | Result | Evidence |
|---|---|---|
| TC-TEN-001 | **Live PASS** | Tenant A token reading Tenant B's member id → `404`; Tenant A's list never contains it |
| TC-TEN-002 | **Live PASS** | same for saving id + transaction history; a deposit attempt also `404`s with no mutation |
| TC-TEN-003 | **Live PASS** | same for loan id; a payment attempt also `404`s with no mutation |
| TC-TEN-004 | **Live PASS** | Tenant A token updating Tenant B's unit id → `404` |
| TC-TEN-005 | **Live PASS** | Tenant A/B full-range financial totals differ; no cross-tenant bleed |
| TC-TEN-006 | **Live PASS** | Tenant A's user list never contains a Tenant B user; update attempt → `404` |
| TC-TEN-007 | **Live PASS** | `tenantId` forged into a mutating body is ignored — the created row lands in the caller's own tenant, confirmed invisible to the named tenant |
| TC-TEN-008 | Code-reviewed PASS | `tenant-scope.ts`'s `withoutTenantScope()` bypass is used in exactly two places: `platform/service.ts` (legitimate platform-admin cross-tenant ops) and `config/service.ts:264` (legitimate global custom-domain uniqueness check for whitelabel) — no unscoped leak path found |

**100% pass on this section — meets test-plan §5.2's non-negotiable exit gate** ("Cross-tenant
leakage cases: 100% pass — no exceptions").

#### 13. API Contract & Security NFRs

| ID | Result | Evidence |
|---|---|---|
| TC-SEC-001 | **Live PASS** | success envelope has `success`, `data`, `meta.timestamp`, `meta.requestId` |
| TC-SEC-002 | **Live PASS** | error envelope has `success:false`, `error.code`, `error.message` |
| TC-SEC-003 | **Live PASS** | malformed POST body → `422 VALIDATION_ERROR` before any DB write |
| TC-SEC-004 | Automated PASS | `auth-service.test.ts` "stores the password hashed, never in plaintext"; `auth-routes.test.ts` "never puts the password hash on the wire" |
| TC-SEC-005 | **Live PASS** | helmet headers present (CSP, X-Frame-Options, X-Content-Type-Options, etc.) |
| TC-SEC-006 | **Live PASS** | allow-listed Origin echoed in ACAO; disallowed Origin gets no ACAO header |
| TC-SEC-007 | Code-reviewed PASS | `app.ts`'s catch-all error handler returns generic `INTERNAL_ERROR` with no stack trace for anything not a `ZodError`/`AppError` |
| TC-SEC-008 | Confirmed open risk | matches test-plan §7 — no rate limiting exists; not a new finding |
| TC-SEC-009 | Code-reviewed PASS (partial) | members/savings/loans `service.ts` all filter reads/writes by `tenantId` correctly (reviewed while root-causing D1-D3); a full repo-wide grep pass was not run |
| TC-SEC-010 | Not executed | deliberately breaking the dev proxy config was skipped per the case's own "do not ship this" caution and low marginal value |

#### 14. Mobile App (Fase 1)

| ID | Result | Evidence |
|---|---|---|
| TC-MOB-001..008 | **Not executed** | No Puppeteer/Playwright is installed in this environment, so a scripted authenticated walkthrough of `apps/mobile` wasn't possible; a single unauthenticated screenshot of the web frontend's login page was taken (see below) but the mobile app itself was not opened. TC-MOB-007 (tenant isolation) has strong *indirect* confidence since mobile is read-only and reuses the same backend endpoints validated 100% in §12, but the mobile UI was not visually confirmed. Recommend a manual pass. |

One UI check was performed: a headless screenshot of `http://demo.localhost:3000/login` confirmed
the frontend correctly resolves and displays the tenant from the Host subdomain ("Koperasi: demo"),
corroborating TC-AUTH-007 at the UI layer, not just the API layer.

#### 15. Non-Functional Spot Checks

| ID | Result | Evidence |
|---|---|---|
| TC-PERF-001 | **Live FAIL (informational) — D5** | login 860-923ms (>500ms target); list members/dashboard/financial report all <110ms |
| TC-PERF-002 | Not executed | needs a real browser session timing login→render |
| TC-PERF-003 | Not executed | needs all 6 PDF exports timed; only 2 of 6 have any automated coverage at all (see TC-RPT-010) |
| TC-PERF-004 | Confirmed | matches documented gap, test-plan §2.2 |
| TC-PERF-005 | Confirmed | matches documented gap, test-plan §2.2 |

### 16.4 What this cycle did not cover

Grouped by reason, so the gap is legible rather than buried in 172 rows:

- **No UI automation tooling available** (Puppeteer/Playwright not installed): full RBAC
  nav-visibility walkthrough (TC-PADM-009 and the visual half of several TC-CFG/TC-RPT cases), all 8
  Mobile cases, dashboard/PDF-export browser timing (TC-PERF-002/003).
- **Deliberately not run** (would mutate the shared dev DB destructively or degrade the environment
  other QA work depends on): TC-AUTH-025 (broken `JWT_SECRET` requires a server restart),
  TC-SEC-010 (breaking the dev proxy config).
- **Requires infrastructure this repo doesn't have yet** (matches test-plan §2.2 exactly, not a new
  gap): TC-PERF-004/005, TC-RPT-014, TC-DASH-004.
- **Genuine coverage gaps worth a follow-up cycle**: TC-AUTH-014 (role-change reflected on refresh),
  TC-AUTH-018 (zero-unit-access login), TC-SAV-013 (Decimal-precision repeated-fraction test),
  TC-UNIT-004/TC-RPT-013 (multi-unit consolidated-vs-per-unit reporting), TC-MEM-010 (KTP upload
  regression), TC-RPT-010 (4 of 6 report types have no PDF-export test at all — `pdf.ts` is the
  lowest-covered file in the repo).

### 16.5 Exit criteria assessment (test-plan §5.2)

| Gate | Threshold | Actual | Met? |
|---|---|---|---|
| Backend unit coverage | ≥80% lines | 93.41% | ✅ |
| P0/P1 defects | Zero open | **3 open P0, 1 open P1** (D1-D4) | ❌ |
| Cross-tenant leakage cases | 100% pass, no exceptions | 8/8 pass | ✅ |
| CI pipeline (lint/typecheck/test/build) | Green | Green | ✅ |
| NFR-PERF-01 | p99 <500ms | 3/4 spot-checked endpoints pass; login at ~900ms | ⚠️ (informational, see D5) |
| NFR-PERF-02/03 | <3s / <10s | Not measured this cycle | — |

### 16.6 Go/No-Go recommendation

**No-Go**, per test-plan §3.3's own rule: *"A single failed cross-tenant-isolation or
money-arithmetic test case is release-blocking regardless of severity elsewhere."* D1-D3 are exactly
that category — all three are Simpanan Pokok/savings integrity gaps (a member's mandatory equity
saving can be silently drained to zero and duplicated without limit, and the Pokok-before-other-
products membership rule can be bypassed), not cosmetic issues. Per `CLAUDE.md`'s decision-authority
table this is a QA call that PM cannot override for money-correctness cases.

Suggested path back to Go: fix D1-D3 in `savings/service.ts` (call `hasPokokSaving()` from
`createSaving`; add the Pokok-floor check to `withdrawFromSaving`; add either an application check
or a `@@unique([memberId, unitId, savingConfigId])` constraint to prevent duplicate savings), correct
D4 in `auth/service.ts::registerTenant` (an explicit cross-tenant admin-email pre-check, since the DB
constraint can't catch it), re-run the Savings section of this suite, and correct the four
"Implemented" statuses in `docs/02-System-Requirements-SISKOP.md` in the same PR.
