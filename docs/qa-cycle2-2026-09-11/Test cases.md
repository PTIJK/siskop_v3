# Test Cases — SISKOP (QA Cycle 2 master case bank, 2026-09-11)

Companion to `docs/08-QA-Test-Plan-SISKOP.md`. This is the up-to-date case bank as of QA Cycle 2 —
sections 1-15 are carried forward from `docs/09-QA-Test-Cases-SISKOP.md` (Cycle 1, 2026-08-27), whose
case definitions remain accurate since none of that code changed in the interim (see `Test
Result.md` §0 for the delta analysis). **Section 16 is new this cycle**, covering the mobile Anggota
self-service portal (`member-auth`/`member-portal` modules, shipped in commit `4c46ee0` after Cycle 1
was written).

Execution results for this cycle live in `Test Result.md`; defects found live in `Bugs List.md`.
Historical Cycle 1 results remain in `docs/09-QA-Test-Cases-SISKOP.md` §16 and are not repeated here.

Type: **P** = positive, **N** = negative/boundary. Priority uses the P0–P3 scale defined in the test
plan §3.3.

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
| TC-MEM-013 | mobile-portal commit `4c46ee0` | N | (Regression) Fetch `GET /members` and `GET /members/:id` and inspect every field returned | Response never includes `passwordHash`, even though the `Member` model now carries that column for portal auth | P0 |

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
| TC-CFG-011 | FR-CFG-05 | P | Set `modalDisetor` ≥ Rp 5,000,000,000 (Rp5 miliar) | Saved; compliance threshold indicator (if any) reflects "met" | P2 |
| TC-CFG-012 | FR-CFG-05 | P | Set `modalDisetor` < Rp 5,000,000,000 (e.g. Rp 5,000,000) | Saved (field itself isn't gated), but any audit-threshold messaging correctly flags below-threshold status | P2 |
| TC-CFG-013 | mobile-portal commit `4c46ee0` | P | Staff opens a member's detail page and clicks "Aktifkan Akses Portal" | `POST /members/:id/portal-access` returns a `defaultPassword`; UI displays it alongside the member's NIK for staff to relay; member's `mustChangePassword` becomes `true` | P1 |
| TC-CFG-014 | mobile-portal commit `4c46ee0` | N | A user without `members: update` permission (e.g. Teller, Viewer) attempts to activate/reset a member's portal access | Blocked, `403` — same permission gate as other member-write actions | P1 |

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

## 14. Mobile App — Staff Fase 1 (read-only desktop-parity views)

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-MOB-001 | Mobile Fase 1 scope | P | Log in on `apps/mobile` (staff `/login`) with valid tenant-subdomain credentials | Session established, same auth flow as web | P1 |
| TC-MOB-002 | Mobile Fase 1 scope | P | Browse Dashboard, Members, Savings, Loans, Reports on mobile | All render read-only, data matches the web app for the same tenant | P1 |
| TC-MOB-003 | Mobile Fase 1 scope | N | Attempt any create/edit/delete action from mobile UI (if a stray control exists) | No mutating action should be reachable — Fase 1 is read-only by design | P1 |
| TC-MOB-004 | Mobile Fase 1 scope | P | Open Anggota Menunggak (Overdue) view on mobile | Accessible **without** requiring the accounting entitlement (permanent access per memory note) | P1 |
| TC-MOB-005 | Mobile Fase 1 scope | P | Open the 3 ported Laporan Regulasi tabs on mobile | Render correctly, matching web figures for the same period | P2 |
| TC-MOB-006 | Mobile Fase 1 scope | P | Open Profil page on mobile (staff), edit name/email | Behaves the same as web `ProfilePage` (FR-AUTH-12) | P2 |
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

## 16. Member Self-Service Portal (Mobile — NEW this cycle)

Covers `apps/backend/src/modules/member-auth/*` and `member-portal/*` (mounted at
`/api/member-auth` and `/api/member`), plus the mobile app's `/anggota/*` routes — all shipped in
commit `4c46ee0` ("feat: add Anggota mobile self-service portal (read-only)"), after Cycle 1's case
bank was written. Members log in directly (separately from staff), using their **NIK** as the
identifier and a staff-activated password, to view their own profile/savings/loans read-only.

> **Traceability gap, not a defect:** this feature has no FR ID in
> `docs/02-System-Requirements-SISKOP.md` yet — the requirements register was not updated when it
> shipped. IDs below use a provisional `FR-MPORT-*` scheme pending that document being updated; per
> test-plan §11, correct this in the same PR that resolves the defects below.

| ID | Req | Type | Scenario & Steps | Expected Result | Priority |
|---|---|---|---|---|---|
| TC-MPORT-001 | FR-MPORT-01 | P | Staff activates portal access for a member (`POST /members/:id/portal-access`), then the member logs in (`POST /api/member-auth/login`) with their NIK and the returned default password | `200`, session issued (access token + httpOnly refresh cookie), `member.mustChangePassword: true` in the payload | P0 |
| TC-MPORT-002 | FR-MPORT-01 | N | Member login with correct NIK but wrong password | `401 UNAUTHORIZED`, generic message | P1 |
| TC-MPORT-003 | FR-MPORT-01 | N | Member login with a NIK that doesn't exist in that tenant, or whose portal access was never activated (`passwordHash` still null) | `401 UNAUTHORIZED` — same generic response either way (dummy-hash comparison keeps timing comparable, mirroring FR-AUTH-05's staff-login design) | P2 |
| TC-MPORT-004 | FR-MPORT-01 | N (security) | Compute a member's default password as `DDMMYYYY` by decoding it directly from their **NIK** alone (digits 7-12 = `DDMMYY`, +40 to the day for a female holder — standard Indonesian NIK encoding), without looking up `birthDate` separately, then log in with it | **Currently succeeds** — see D6 in `Bugs List.md`. Flagging this as its own case because the vulnerability is "the login identifier itself contains the password," not merely "the default password is a guessable formula" | P0 |
| TC-MPORT-005 | FR-MPORT-01 | N (security) | After a successful login where `mustChangePassword: true` (password never changed), call `GET /api/member/dashboard`, `/savings`, `/loans` without first calling `PUT /api/member-auth/me/password` | **Currently succeeds with real data** — see D6 in `Bugs List.md`. Expected: these endpoints should reject with a dedicated error until the password is changed, or the mobile app should force the change screen and the API should back that up server-side | P0 |
| TC-MPORT-006 | FR-MPORT-02 | P | Member changes password: `PUT /api/member-auth/me/password` with correct `currentPassword` and a `newPassword` ≥8 chars | `200`; `mustChangePassword` flips to `false` on `/me` and subsequent logins | P1 |
| TC-MPORT-007 | FR-MPORT-02 | N | Change password with an incorrect `currentPassword` | `401`, "Password saat ini salah"; password unchanged (old password still works) | P1 |
| TC-MPORT-008 | FR-MPORT-02 | N | Change password with `newPassword` of 7 characters | `VALIDATION_ERROR`, "Password baru minimal 8 karakter" | P2 |
| TC-MPORT-009 | FR-MPORT-02 | N | After a successful password change, attempt to log in again with the **old** (default) password | `401` — old password no longer valid | P1 |
| TC-MPORT-010 | FR-MPORT-03 | P | Member calls `GET /api/member/dashboard` | Returns only that member's own aggregates: `totalSavingsBalance`, `savingsAccountCount`, `activeLoanCount`, `totalLoanRemaining` | P1 |
| TC-MPORT-011 | FR-MPORT-03 | P | Member calls `GET /api/member/savings`, `/savings/:id`, `/savings/:id/transactions` for their **own** saving | Full read access to own records, matching what staff sees for that member | P2 |
| TC-MPORT-012 | FR-MPORT-03 | P | Member calls `GET /api/member/loans`, `/loans/:id` for their **own** loan | Full read access to own records | P2 |
| TC-MPORT-013 | NFR-TENANT-03 (member-scoped, new) | N | Member A's token used against Member B's saving/loan id (`GET /api/member/savings/:id`, `/loans/:id`) — both members in the **same** tenant | `404 NOT_FOUND` (never `403`, so the id's existence is never confirmed either way) — `assertOwnsMember` in `member-portal/service.ts` | P0 |
| TC-MPORT-014 | Session-type isolation | N | A **staff** Bearer token used against any `/api/member/*` or `/api/member-auth/me` endpoint | `401` — staff claims (`userId`/role `tenant_admin`) fail the member-claims schema | P0 |
| TC-MPORT-015 | Session-type isolation | N | A **member** Bearer token used against any staff endpoint (e.g. `GET /api/members`) | `401` — member claims (`memberId`/role `member`) fail the staff-claims schema | P0 |
| TC-MPORT-016 | FR-MPORT-01 | P | Two different tenants each have a member with the **same NIK**; each logs in on their own tenant's subdomain | Each resolves to their own tenant's member only — `tenantId_nik` compound lookup, no cross-tenant confusion | P0 |
| TC-MPORT-017 | FR-CFG (mirrors TC-CFG-013/014) | P/N | Staff activation endpoint permission-gated the same as other member-write actions | Covered under §8 as TC-CFG-013/014 — cross-referenced here for the member-portal feature area | P1 |
| TC-MPORT-018 | Regression (fixed in `4c46ee0`) | P | `GET /api/members`, `/members/:id` response body inspected field-by-field | No `passwordHash` field present — cross-referenced as TC-MEM-013 in §3 | P0 |
| TC-MPORT-019 | FR-MPORT-01 | P | Member calls `POST /api/member-auth/refresh` with a valid refresh cookie | New access token issued without re-authenticating; refresh cookie rotated | P2 |
| TC-MPORT-020 | Session-type isolation | N | The member refresh cookie (`siskop_member_refresh_token`, path `/api/member-auth`) is distinct from the staff refresh cookie — confirm neither can be used to refresh the other session type | Each refresh endpoint only accepts its own cookie name/claims shape | P2 |
| TC-MPORT-021 | Mobile UI | N | An unauthenticated browser session navigates directly to a protected `/anggota/*` URL (e.g. `/anggota/dashboard`) with no prior login in that browser profile | Client-side route guard redirects to `/anggota/login` — **verify with a genuinely fresh browser context/profile**, not a second tab sharing `localStorage` with an already-logged-in tab (that produces a false pass) | P2 |
| TC-MPORT-022 | FR-MPORT-01 | N | A deactivated member (`isActive: false`) attempts to log in with an otherwise-correct password | `401` — `loginMember` checks `member.isActive` | P1 |
| TC-MPORT-023 | Mobile Fase 1 scope (read-only) | N | Inspect the mobile member-facing UI and the `/api/member/*` route table for any mutating (POST/PUT/DELETE) endpoint beyond login/password-change | None found — the entire member-portal surface besides auth/password-change is `GET`-only, matching the "read-only" scope in the commit message | P2 |

---

## Summary

| Module | # Cases | P0 | P1 |
|---|---|---|---|
| Auth & Provisioning | 26 | 8 | 9 |
| Multi-Unit Model | 5 | 1 | 1 |
| Members | 13 | 2 | 3 |
| Savings | 16 | 6 | 5 |
| Loans | 22 | 11 | 6 |
| Accounting/Ledger | 10 | 2 | 6 |
| Reports | 14 | 4 | 7 |
| Config | 14 | 1 | 9 |
| Platform Admin | 12 | 3 | 6 |
| Dashboard | 4 | 1 | 1 |
| RBAC | 8 | 1 | 4 |
| Multi-Tenant Isolation | 8 | 8 | 0 |
| API Contract & Security | 10 | 1 | 4 |
| Mobile (Staff, Fase 1) | 8 | 1 | 4 |
| Non-Functional | 5 | 0 | 0 |
| **Member Self-Service Portal (NEW)** | **23** | **8** | **7** |
| **Total** | **198** | **58** | **72** |

The P0 concentration in Savings, Loans, Multi-Tenant Isolation, and now the new Member Self-Service
Portal section is intentional — money-arithmetic, tenant isolation, and (as of this cycle)
credential-predictability/auth-bypass are the categories test-plan §3.3 makes release-blocking
regardless of severity elsewhere, and none of those cases are eligible for a PM override on failure.
