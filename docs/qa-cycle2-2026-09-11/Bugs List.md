# Bugs List — SISKOP QA Cycle 2 (2026-09-11)

| | |
|---|---|
| Cycle | 2 |
| Baseline | `main` @ `4c46ee0` (2026-09-11) |
| Previous cycle | Cycle 1, 2026-08-27, baseline `61cc34f` — see `docs/09-QA-Test-Cases-SISKOP.md` §16.2 |
| Companion documents | `Test cases.md`, `Test Result.md` (this folder) |
| Severity scale | P0 blocker / P1 critical / P2 major / P3 minor — per `docs/08-QA-Test-Plan-SISKOP.md` §3.3 |

Every defect cites the TC ID and FR/NFR it violates, per `docs/08-QA-Test-Plan-SISKOP.md` §10, so
`docs/02-System-Requirements-SISKOP.md` can be corrected in the same fix PR if the requirement was
mis-scoped rather than mis-implemented.

## Summary

| ID | Severity | Status | Module | One-line summary |
|---|---|---|---|---|
| [D1](#d1-p0--open) | P0 | **Open** (carried forward, re-confirmed) | Savings | Opening a Wajib/Sukarela saving never checks the member has an active Pokok saving first |
| [D2](#d2-p0--open) | P0 | **Open** (carried forward, re-confirmed) | Savings | Simpanan Pokok can be withdrawn all the way to zero |
| [D3](#d3-p0--open) | P0 | **Open** (carried forward, re-confirmed) | Savings | A member can open unlimited duplicate savings for the same product |
| [D4](#d4-p1--open) | P1 | **Open** (carried forward, re-confirmed) | Auth | Tenant registration doesn't reject an admin email already used by another tenant |
| [D5](#d5-p2--informational--open) | P2 (informational) | **Open** (carried forward, re-confirmed) | Auth / Perf | Login latency (~790–920ms) exceeds the 500ms p99 NFR target |
| [D6](#d6-p0--new) | **P0** | **New** | Member Portal (mobile) | Default member-portal password is derivable from the member's own NIK, and nothing server-side enforces the "must change on first login" rule — a member's savings/loan balances are readable by anyone who can compute it, before the real member ever logs in |

**Zero new defects found outside the mobile self-service portal** — the rest of the codebase is
unchanged since Cycle 1 (only commit since then is `4c46ee0`, the mobile portal feature itself; see
`Test Result.md` §1).

**Release recommendation: No-Go.** Unchanged from Cycle 1 — D1-D3 (money-arithmetic /
Pokok-integrity) and now D6 (auth-bypass exposing real financial data) are all release-blocking per
test-plan §3.3, regardless of any other severity. See `Test Result.md` §7 for the full go/no-go
writeup.

---

## D1 — P0 — Open

**Opening a Wajib/Sukarela saving does not check the member has an active Pokok saving.**

- **TC ID:** TC-SAV-003
- **FR violated:** FR-SAV-06 (marked "Implemented" in `docs/02-System-Requirements-SISKOP.md` — status is stale)
- **Location:** `apps/backend/src/modules/savings/service.ts`, `createSaving()` (currently lines 99-151)
- **Root cause:** `hasPokokSaving()` exists (same file, `hasPokokSaving`, currently lines 259-264) but
  is only ever called from `loans/service.ts::createLoan`. The loan-side gate works correctly
  (TC-LOAN-008, live-verified). `savings/service.ts::createSaving` never calls it — there is no
  equivalent check on the savings side.
- **Repro (Cycle 2, 2026-09-11, live against `demo` tenant):**
  1. Create a brand-new member with no savings at all.
  2. `POST /api/savings` with that member's id and a **Wajib** `savingConfigId`.
  3. **Actual:** `201 Created` — the Wajib saving opens successfully.
  4. **Expected:** `422 MEMBER_HAS_NO_POKOK_SAVING` (the same error the loan-side gate already throws).
- **Impact:** A member can hold Wajib/Sukarela savings without ever opening the mandatory Pokok
  (equity) saving, which the cooperative's membership model requires as the base product. Money-
  correctness / membership-integrity category — release-blocking per test-plan §3.3 regardless of
  severity elsewhere.
- **Suggested fix:** Call `hasPokokSaving(tenantId, data.memberId)` at the top of `createSaving()` and
  throw the same `MEMBER_HAS_NO_POKOK_SAVING` error the loan path uses, unless the saving being
  opened is itself the Pokok product.

---

## D2 — P0 — Open

**A Simpanan Pokok can be withdrawn all the way to zero.**

- **TC ID:** TC-SAV-011
- **FR violated:** FR-SAV-05 (marked "Implemented" — status is stale)
- **Location:** `apps/backend/src/modules/savings/service.ts`, `withdrawFromSaving()` (currently lines 207-256)
- **Root cause:** The only `CANNOT_WITHDRAW_POKOK` check in the codebase (lines 226-236) guards a
  *different* rule — "no withdrawal while the member has an active loan." There is no floor/never-
  zero check on Pokok balance at all.
- **Repro (Cycle 2, 2026-09-11, live against `demo` tenant):**
  1. A member with a Pokok saving of 750,000 and **no active loan**.
  2. `POST /api/savings/:id/withdraw` with `amount: 750000`.
  3. **Actual:** `201 Created`, balance goes to exactly 0.
  4. **Expected:** rejected with `CANNOT_WITHDRAW_POKOK` (or a dedicated floor error) — Pokok is
     mandatory equity and should never reach zero while membership is active.
- **Impact:** A member's mandatory equity saving can be silently drained to zero, which breaks the
  cooperative-membership model (Pokok is meant to represent permanent minimum equity). Money-
  arithmetic/integrity category — release-blocking per test-plan §3.3.
- **Suggested fix:** In the `POKOK` branch of `withdrawFromSaving`, reject when
  `data.amount >= Number(saving.balance)` (or a configured minimum floor > 0), independent of the
  existing active-loan check.

---

## D3 — P0 — Open

**A member can open unlimited duplicate savings for the same (member, unit, config) triple.**

- **TC ID:** TC-SAV-005
- **FR violated:** FR-SAV-02 (marked "Implemented" — status is stale)
- **Location:** `apps/backend/src/modules/savings/service.ts`, `createSaving()`; schema:
  `apps/backend/prisma/schema.prisma`, `model Saving` (currently lines 356-376)
- **Root cause:** No application-level duplicate check in `createSaving`, and the `Saving` model has
  no `@@unique` constraint on `(memberId, unitId, savingConfigId)` to catch it at the DB layer either
  — only non-unique `@@index`es exist.
- **Repro (Cycle 2, 2026-09-11, live against `demo` tenant):**
  1. A member with an existing Pokok saving.
  2. `POST /api/savings` again with the **same** member id and the **same** Pokok `savingConfigId`.
  3. **Actual:** `201 Created` — a second, independent Pokok saving account is created for the same
     member. Confirmed visually in the mobile self-service portal (`/anggota/simpanan`): the member
     sees two separate "Simpanan Pokok" rows.
  4. **Expected:** `409 CONFLICT` (or equivalent) — a member should have at most one open account per
     saving product per unit.
- **Impact:** Duplicate mandatory-product accounts fragment a member's equity and would corrupt SHU
  allocation and regulatory-report per-member aggregates that assume one Pokok account per member.
  Money-arithmetic/integrity category — release-blocking per test-plan §3.3.
- **Suggested fix:** Add `@@unique([memberId, unitId, savingConfigId])` to the `Saving` model (new
  migration) and/or an explicit pre-check in `createSaving` returning `CONFLICT`.

---

## D4 — P1 — Open

**Tenant registration doesn't reject an admin email already used by another tenant.**

- **TC ID:** TC-AUTH-004
- **FR violated:** FR-AUTH-02 (marked "Implemented" — status is stale)
- **Location:** `apps/backend/src/modules/auth/service.ts`, `registerTenant()` (currently lines 98-137)
- **Root cause:** `User.email` uniqueness is `@@unique([tenantId, email])` — scoped per tenant, not
  global — so the cross-tenant collision this rule is meant to catch can never produce the `P2002`
  Postgres error `isUniqueViolation()` (lines 139-144) relies on. Slug and registrationNo duplicates
  (the other two clauses of the same business rule) correctly return `CONFLICT`; only the
  admin-email clause is unenforced.
- **Repro (Cycle 2, 2026-09-11, live):**
  1. `POST /api/auth/register` a brand-new tenant (`qa-cycle2-dup-admin-test`) reusing
     `admin@demo.com` — already the admin email of the existing `demo` tenant — as `adminEmail`.
  2. **Actual:** `201 Created` — a second, entirely separate tenant and user are created with the
     same email.
  3. **Expected:** `409 CONFLICT`.
  4. *(Test tenant deactivated via Platform Admin after the repro to avoid polluting the shared dev
     database — see `Test Result.md` §1 for cleanup note.)*
- **Impact:** The same person's email can silently authenticate as an admin of two unrelated
  cooperatives, undermining the "one admin identity per registration" assumption the UI and support
  workflows are built on. Not a cross-tenant *data* leak (session/JWT still carries only one
  `tenantId` at a time — `TC-AUTH-004b` continues to pass), but a genuine business-rule bypass.
- **Suggested fix:** An explicit pre-check in `registerTenant` — `db.user.findFirst({ where: { email: data.adminEmail } })` across all tenants — before attempting the insert, since the DB constraint structurally cannot catch this case.

---

## D5 — P2 / informational — Open

**Login latency (~790–920ms) exceeds the 500ms p99 NFR target.**

- **TC ID:** TC-PERF-001
- **NFR violated:** NFR-PERF-01 (API p99 < 500ms)
- **Location:** `apps/backend/src/modules/auth/service.ts` — `BCRYPT_ROUNDS = 10`
- **Re-measured (Cycle 2, 2026-09-11):** `POST /api/auth/login` — 787ms, 816ms, 892ms across 3 fresh
  samples (consistent with Cycle 1's 860-923ms). `GET /api/members` (authenticated, same tenant) —
  ~18ms, comfortably under budget — confirming the cost is isolated to the login path, not a general
  regression.
- **Impact:** Same assessment as Cycle 1 — looks bcrypt-cost-bound rather than a systemic latency
  problem. Informational; not independently release-blocking, but flagged every cycle until a
  deliberate call is made.
- **Recommendation (unchanged from Cycle 1):** QA cannot decide whether to carve out an NFR exception
  for the login endpoint specifically, or tune `BCRYPT_ROUNDS` down (weighing the security cost of
  fewer rounds) — Engineer/PM call per `CLAUDE.md` decision authority.

---

## D6 — P0 — New

**Default member-portal password is derivable from the member's own NIK, and no server-side check enforces the "must change password on first login" rule — a member's real financial data is exposed to anyone who can compute it, before the member ever logs in.**

- **TC ID(s):** New this cycle — see `Test cases.md` §16 (TC-MPORT-004, TC-MPORT-005, TC-MPORT-014)
- **FR/NFR implicated:** FR-MOB-* (member self-service login, `docs/06-PRD-SISKOP-Mobile-Version.md`);
  no explicit NFR currently covers "default credential unpredictability" — worth adding one.
- **Location:**
  - `apps/backend/src/modules/member-auth/service.ts`, `defaultPasswordFromBirthDate()` (lines 21-27)
    and `activatePortalAccess()` (lines 55-71) — the default/reset password is always `DDMMYYYY` of
    the member's `birthDate`.
  - `apps/backend/src/modules/member-portal/routes.ts` (line 24, `router.use(requireMemberAuth)`) and
    `service.ts` — every data endpoint (`/dashboard`, `/savings`, `/savings/:id`,
    `/savings/:id/transactions`, `/loans`, `/loans/:id`) requires only a **valid** member JWT.
    `mustChangePassword` is returned in the `/me` and login payloads but is never checked before
    serving data — there is no middleware or service-level gate on it anywhere in the module.
  - The `DDMMYYYY` convention is not hidden — it is stated in-product, both in the staff activation
    dialog (`apps/frontend/src/pages/members/MemberDetailPage.tsx:288-290`, *"Kata sandi akan diatur
    ulang ke tanggal lahir anggota (format DDMMYYYY)"*) and on the member login screen itself
    (`apps/mobile/src/pages/member/MemberLoginPage.tsx`, rendered text confirmed live: *"Kata sandi
    awal adalah tanggal lahir Anda (format DDMMYYYY), diaktifkan oleh petugas koperasi."*).
- **Why this is exploitable, not just theoretical:** Indonesia's standard 16-digit NIK format encodes
  the holder's date of birth directly in digits 7-12 as `DDMMYY` (day +40 for a female holder), with
  the remaining 4 digits a sequence number. This is public, widely-known encoding — not a secret this
  system holds. Anyone who has a member's NIK (visible on membership rosters, KTP copies on file,
  loan paperwork, or simply guessed via the sequence range for a known cooperative) can decode the
  exact `DDMMYYYY` default password without ever separately learning the member's birthdate, then
  combine that with the in-product hint above confirming the exact format to use.
- **Repro (Cycle 2, 2026-09-11, live end-to-end against `demo` tenant):**
  1. Staff creates member "QA Cycle2 Portal Test", NIK `3201015505990001`, `birthDate: 1999-05-15`.
     (NIK digits 7-12 = `550599` → day `55-40=15`, month `05`, year `99` → decodes to exactly
     1999-05-15, confirming the encoding.)
  2. Staff opens a Pokok saving for the member with a 750,000 initial deposit (simulating a real
     funded account).
  3. Staff activates portal access: `POST /api/members/:id/portal-access` → returns
     `{"defaultPassword":"15051999","mustChangePassword":true}` — exactly `DDMMYYYY`, decodable from
     the NIK alone per step 1, no separate birthdate lookup needed.
  4. **Before the real member ever logs in**, an attacker who only knows the NIK computes the
     password and calls `POST /api/member-auth/login` with `{"nik":"3201015505990001","password":
     "15051999"}` → **`200 OK`**, full session issued, `mustChangePassword: true` in the response.
  5. Using that session (still `mustChangePassword: true`, password never changed):
     `GET /api/member/dashboard` → **`200 OK`**, `{"totalSavingsBalance":"750000", ...}`.
     `GET /api/member/savings` → **`200 OK`**, full saving record including balance.
  6. **Nothing in the request path checks `mustChangePassword`** — the attacker has full read access
     to the member's real financial data indefinitely, for as long as the legitimate member hasn't
     happened to log in and change the password first.
  7. Confirmed the mirror-image UI flow live in the mobile app (`/anggota/login` →
     `/anggota/dashboard` → `/anggota/simpanan`) renders the same real balance with no interstitial
     forced-password-change screen blocking it.
- **What does work correctly (verified, not part of this defect):** cross-member ownership checks
  (`assertOwnsMember` in `member-portal/service.ts`) correctly 404 when Member A's token is used
  against Member B's saving/loan id; member and staff session tokens correctly reject each other;
  wrong-password attempts are correctly rejected with a dummy-hash timing-equalization identical in
  spirit to the staff login path; the client-side route guard on `/anggota/*` correctly redirects a
  genuinely unauthenticated browser session to `/anggota/login`.
- **Impact:** This is an auth-bypass exposing real member financial data (savings balance, loan
  balance, transaction history) — matches the P0 "auth bypass" criterion in test-plan §3.3's
  severity table directly. Scored P0 rather than P1 because it requires no more than knowledge of a
  NIK the cooperative itself already holds on file for every member, the exact password format is
  disclosed by the product's own UI, and the payload exposed is real money data — the same class of
  finding (unauthorized visibility into a real balance) that made D1-D3 release-blocking.
- **Suggested fix (two independent layers, both worth doing):**
  1. **Enforce the flag.** Add a check (route-level or a small middleware) that rejects
     `mustChangePassword: true` sessions on every `/api/member/*` and `/api/member-auth/me`
     endpoint except `PUT /api/member-auth/me/password` itself, with a distinct error code the mobile
     app already has the UI for (`/anggota/ganti-password` exists and is reachable).
  2. **Stop the default password being derivable from the login identifier.** Options for
     Engineer/PM to weigh: require the staff member to set/communicate a random one-time password
     out-of-band instead of a deterministic formula; or require a second factor (e.g., account number,
     which is not embedded in the NIK) in addition to the birthdate-derived password on *first* login
     only.

---

## Carried-forward risk register (unchanged from Cycle 1, not re-litigated here)

Per `docs/08-QA-Test-Plan-SISKOP.md` §7 — no rate limiting on login (NFR-SEC-09), no frontend/mobile
automated test coverage (NFR-TEST-07), package quotas unenforced (NFR-SAAS-03), no load testing.
Status unchanged this cycle; see `Test Result.md` §6 for the refreshed coverage-gap list specific to
Cycle 2 (mostly closed, since Puppeteer-driven UI automation was available this cycle where it wasn't
in Cycle 1).
