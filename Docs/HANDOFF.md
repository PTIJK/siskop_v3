# Session Handoff

Standing doc for picking up work across sessions — update it whenever a work session ends with follow-on work remaining. Not project documentation (see `Docs/01-PRD-SISKOP.md` etc. for that) — this is scratch state for continuity only. Safe to trim old entries once their follow-ups are done and merged.

---

## 2026-07-22 (cont'd 2) — Regulatory financial reporting: Phase 3 step 2 (Laporan Hasil Usaha + SHU distribution)

### Context

Continuation of the same day's work, roadmap item 2 from the Phase 2 entry below: "Laporan Perhitungan Hasil Usaha + Daftar Pembagian SHU per Anggota — needs the `ShuDistributionConfig` model (spec §5.4, not yet created) plus report logic (§6.2/§6.4)." Same design spec, `Docs/specs/2026-07-22-pelaporan-regulasi-design.md`.

### What's done (uncommitted — still nothing from this entire day has been committed)

**Schema** — new migration `prisma/migrations/20260722034237_add_shu_distribution_config/`:
- `ShuDistributionConfig` model exactly per spec §5.4 (`jasaSimpananPercent`/`jasaPinjamanPercent`/`cadanganPercent`/`lainnyaPercent`, one per tenant, `@unique` on `tenantId`).

**Config endpoints** — new files `apps/backend/src/modules/config/shu-distribution.{schema,service,controller}.ts`, routes added to `config.router.ts`, same `requireAccountingEntitlement` + `requirePermission('accounting', ...)` gate as the rest of Konfigurasi Akun:
- `GET /api/config/shu-distribution` — returns `null` if not configured yet (not a 404 — matches the "not yet set up" pattern already used for Arus Kas's missing cash-equivalent accounts).
- `PUT /api/config/shu-distribution` — upsert; validates the 4 percentages sum to exactly 100, else `422 SHU_DISTRIBUTION_PERCENT_INVALID` (new error code).

**Report endpoints** — two new methods added to the existing `RegulatoryReportsService` (`apps/backend/src/modules/reports/regulatory-reports.service.ts`), controllers in `regulatory-reports.controller.ts`, routes in `reports.router.ts`, same entitlement/`"reports"` permission gate as Neraca/Arus Kas:
- `GET /api/reports/regulatory/laporan-hasil-usaha?from=&to=` (§6.2) — `SUM(PENDAPATAN) − SUM(BEBAN)` for the period (entryDate range, not cumulative like Neraca). **Deliberate deviation from the spec's literal wording**: §6.2 says the result "is then posted as a closing entry" to `3-3000 SHU Tahun Berjalan` — this was *not* implemented. Auto-posting a closing `JournalEntry` needs its own design (when it fires, idempotency so re-viewing the report doesn't double-post, what happens on an amended prior period) that was never made, and Neraca already handles unclosed income correctly via its computed "SHU Tahun Berjalan (Belum Ditutup)" line from the previous step. Keeping this read-only avoids a double-posting risk with no design behind it — flag for Accounting/Compliance + Backend review before treating this as done. Member/non-member split (spec §2 point 3) is structurally present (`anggota`/`bukanAnggota` per line item) but `bukanAnggota` is always `'0'` per the closed-loop assumption.
- `GET /api/reports/regulatory/shu-distribution?from=&to=` (§6.4) — allocates the period's SHU across the 4 `ShuDistributionConfig` buckets, then divides `jasaSimpanan`/`jasaPinjaman` proportionally per active member. Two data-derivation choices worth knowing about:
  - **Jasa pinjaman (interest paid) is re-derived per member via `splitPrincipalAndInterest()` over each `LoanPayment` in the period**, not read off `JournalLine` — because `PAYMENT_INTEREST` and `PAYMENT_PENALTY` both post to `PENDAPATAN`-category accounts and `JournalLine` doesn't retain which `transactionKind`/mapping produced a given line, so there's no reliable way to isolate "interest only" from posted ledger lines alone. Re-deriving from `LoanPayment` guarantees it matches what was actually posted as interest income (same formula, same inputs as `journal.ts`), not a separate estimate.
  - **Jasa simpanan (average savings balance) is approximated as the mean of balance-at-period-start and balance-at-period-end**, each reconstructed exactly by taking a member's current `Saving.balance` and reversing every `SavingTransaction` that happened after that date (`memberSavingsBalanceAsOf()` helper). This is *not* a true daily time-weighted average — SISKOP has no daily balance snapshot mechanism — but it's a documented, commonly-used simplification (some koperasi already compute "saldo rata-rata" this way manually). Flag if a tenant's Accounting SME wants a stricter time-weighted calculation; would need to walk every transaction in the period rather than just the two endpoints.
  - Returns `catatan` (no allocation) if `ShuDistributionConfig` isn't set yet, or if the period's SHU isn't positive (no negative/zero distribution).

**Error codes**: `SHU_DISTRIBUTION_PERCENT_INVALID` (422) added to `errors.ts` and documented in `docs/api-conventions.md`.

**Test cleanup**: `apps/backend/tests/helpers/setup.ts` `cleanupTenant()` now also deletes `shuDistributionConfig` before `journalLine` (FK order) — same pattern as the Phase 2 fix for `journalEntry`/`journalLine`.

**Docs updated**: `docs/api-conventions.md` — new error code row + new routes in the "Laporan Keuangan Regulasi" section + new `PUT/GET /api/config/shu-distribution` rows under Konfigurasi Akun.

**Tests**: `apps/backend/tests/shu-distribution.test.ts` (new, 6 tests) — Laporan Hasil Usaha aggregation cross-checked against `splitPrincipalAndInterest()` applied to the actual posted `LoanPayment` (not hardcoded), the "not configured yet" `catatan` fallback, `PUT` percent-sum validation (reject and accept), and the full distribution flow across two members (one with only savings, one with savings + a loan payment) verifying per-member allocation and the `totalDibagikanKeAnggota` self-check. **Status: 14/14 suites, 158/158 tests passing** (152 from the previous step + 6 new). `npx tsc --noEmit` clean in `apps/backend`.

### Not done in this step (still open)

- **PDF export** for all four regulatory report endpoints — still skipped, same reasoning as the previous step.
- **The closing-entry question** for Laporan Hasil Usaha (see above) — needs a real design decision before it's built, not just an implementation gap.
- Frontend UI — backend-only again this session.
- **CALK** — next roadmap item, mostly narrative/rich-text per spec §6.5.
- `Tenant.modalDisetor` + audit-threshold (Rp5M) notification cron (§5.3/§6.6) — independent, can be done anytime, still not started.
- LPEA — still explicitly deferred (§2, §14), needs its own calculation spec.

### Operational notes for the next session

- Three uncommitted work sessions have now piled up on `main` in one day (Phase 2, Phase 3 step 1, Phase 3 step 2) — strongly consider committing (in however many logical commits make sense) before a 4th session starts, to avoid an unreviewable wall of diff.
- Same local dev `node.exe`-killing note as the entries below applied a third time this session (`EPERM` on `prisma generate` mid-migration) — at this point assume every `prisma migrate dev` in this environment will need it; not worth re-noting again per-session, just do it reflexively when the generate step hangs.

---

## 2026-07-22 (cont'd) — Regulatory financial reporting: Phase 3 step 1 (Neraca + Laporan Arus Kas)

### Context

Continuation of the same day's Phase 2 session below — picked up at "Next steps" item 1 from that entry. Design spec unchanged: `Docs/specs/2026-07-22-pelaporan-regulasi-design.md` §6.1 (Neraca) / §6.3 (Arus Kas).

### What's done (uncommitted — still nothing from this whole day's work has been committed)

**Schema** — one new field, one new migration `prisma/migrations/20260722032504_add_account_cash_equivalent_flag/`:
- `Account.isCashEquivalent` (`Boolean @default(false)`) — the spec's §8 `mark-cash-equivalent` endpoint referenced a flag that didn't exist yet; added it rather than hardcoding on default codes `1-1000`/`1-1010`, so tenants can mark additional cash/bank accounts (e.g. a second bank account) too.
- `coa.template.ts` / `coa.service.ts` — the default COA template's `1-1000 Kas` and `1-1010 Bank` are now seeded with `isCashEquivalent: true` automatically.

**New endpoint** — `POST /api/config/accounts/:id/mark-cash-equivalent` (body: `{ isCashEquivalent: boolean }`), same entitlement/permission gate as the rest of Konfigurasi Akun (`requireAccountingEntitlement` + `requirePermission('accounting', 'update')`). Service/controller/schema additions in the existing `coa.*` files, route in `config.router.ts`.

**Report endpoints** — new files `apps/backend/src/modules/reports/regulatory-reports.service.ts` + `regulatory-reports.controller.ts`, routes added to the existing `reports.router.ts`:
- `GET /api/reports/regulatory/neraca?asOfDate=` — cumulative ledger balance per account since inception, grouped by category, sign-adjusted by `normalBalance`. **Important nuance**: no P&L closing-entry step exists yet (that's Laporan Hasil Usaha, still unbuilt), so the raw ledger's PENDAPATAN/BEBAN balances aren't swept into equity anywhere. To make the spec's "ASET = KEWAJIBAN + EKUITAS" self-check hold, the service computes current-period net income (`SUM(PENDAPATAN) − SUM(BEBAN)` since inception) and folds it into the EKUITAS section as a synthetic, clearly-flagged (`isComputed: true`) "SHU Tahun Berjalan (Belum Ditutup — Dihitung Otomatis)" line rather than posting a real closing `JournalEntry`. This is standard accounting practice for an interim balance sheet, not a workaround — documented in the code comment. Revisit/replace with a real closing entry once Laporan Hasil Usaha is built.
- `GET /api/reports/regulatory/arus-kas?from=&to=` — direct method, groups `JournalLine`s touching `Account.isCashEquivalent=true` accounts into Operasi/Investasi/Pendanaan. **Judgment call, not spec-literal**: the design spec's §6.3 prose doesn't explicitly say which bucket `LOAN_DISBURSEMENT` belongs to (it only mentions "setoran/penarikan simpanan, pembayaran cicilan, biaya operasional" for Operasi). Treated all three auto-posted `JournalSourceType`s (`SAVING_TRANSACTION`, `LOAN_PAYMENT`, `LOAN_DISBURSEMENT`) as Operasi, since lending is a KSP's core operating activity, not a side investment. `MANUAL`-sourced entries (nothing currently auto-posts these) are classified by their non-cash counter-account's category instead: `ASET` counter → Investasi, `EKUITAS` counter → Pendanaan, else Operasi. Flag this for Accounting/Compliance SME review if it matters before RAT — it's a reasonable default but wasn't in the resolved-decisions table.
- Both endpoints self-check against the ledger (`balanced: true/false` field) and return `.toString()` monetary values per `docs/api-conventions.md`.
- Gated by `requireAccountingEntitlement` (unchanged from Phase 1/2) but under the **existing** `"reports"` permission key (`requirePermission('reports', 'read')`), not a new `"accounting"`-scoped one — confirmed `Permissions.reports` already exists in `packages/shared`.

**Error codes**: `REPORT_PERIOD_INVALID` (422, `from > to`) added to `errors.ts` per spec §9. `JOURNAL_ENTRY_UNBALANCED` (added last session) and this one are now both documented in `docs/api-conventions.md`.

**Docs updated**: `docs/api-conventions.md` — new error code row + new "Route Namespacing — Laporan Keuangan Regulasi" section.

**Tests**: `apps/backend/tests/regulatory-reports.test.ts` (new, 7 tests) — entitlement/permission gate (403 FEATURE_NOT_ENTITLED / FORBIDDEN), Neraca aggregation cross-checked directly against `testPrisma.journalLine` sums (not hardcoded expected numbers, so it stays correct if the mapped test amounts ever change), Arus Kas period-invalid rejection, Arus Kas opening/closing reconciliation against the actual ledger balance, mark-cash-equivalent toggle, and the "no cash-equivalent accounts marked yet" fallback (`catatan` field). **Status: 13/13 suites, 152/152 tests passing** (145 from Phase 2 + 7 new). `npx tsc --noEmit` clean in `apps/backend`.

### Not done in this step (still open, unchanged from Phase 2 handoff)

- **PDF export** for Neraca/Arus Kas (`/neraca/pdf`, `/arus-kas/pdf` per spec §8) — skipped in this step to keep it to the "lowest risk" read-only JSON endpoints described in the Phase 2 roadmap. Would reuse the puppeteer + inline-HTML-template + header/footer pattern already in `reports.service.ts`'s `generatePDF`/`renderTemplate`.
- Frontend UI for these two reports — backend-only this session, no `apps/frontend` changes.
- Laporan Perhitungan Hasil Usaha + Daftar Pembagian SHU per Anggota (needs `ShuDistributionConfig` model, not yet created) — next roadmap item.
- CALK, `Tenant.modalDisetor` audit-threshold notification, LPEA — unchanged, see Phase 2 entry below.

### Operational notes for the next session

- Still nothing from today committed — `git status` will show everything from both this entry and the Phase 2 entry below as modified/untracked. Review and commit before continuing, or continue building — your call, but don't let it pile up further into a 3rd uncommitted session.
- Same local dev `node.exe`-killing note as below applied again this session (`EPERM` on `prisma generate` mid-migration) — already handled, just flagging the pattern recurs.

---

## 2026-07-22 — Regulatory financial reporting: Phase 2 (journal posting engine)

### Context

`Docs/regulatory-reporting-requirements.md` (new, added this session) is panel research confirming Permenkop UKM No. 2/2024 requires 5 SAK EP financial statements (Neraca, Laporan Perhitungan Hasil Usaha, Laporan Arus Kas, Laporan Promosi Ekonomi Anggota, CALK) — already in force since tahun buku 2025. SISKOP's `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md` (Phase 1, already shipped — `Account`/`AccountMapping`) staged this as Phase 2 (journal/posting engine) → Phase 3 (the statements themselves), both previously unspecced.

Wrote `Docs/specs/2026-07-22-pelaporan-regulasi-design.md` — the Phase 2+3 design spec, panel-reviewed format matching the COA spec. Read that doc first for full rationale, resolved decisions, and what's explicitly deferred (LPEA calculation, RAT governance docs, KSJK/OJK monitoring, RUU Perkoperasian).

### What's done (uncommitted — nothing in this session has been committed yet)

Phase 2 (journal/posting engine) is implemented and tested, per user direction to "start" with it before Phase 3 report generation.

**Schema** — `prisma/schema.prisma`, migration `prisma/migrations/20260722023957_add_journal_posting_engine/`:
- `JournalEntry` / `JournalLine` models (double-entry, tenant-scoped).
- Enums `JournalSourceType` (`SAVING_TRANSACTION`/`LOAN_PAYMENT`/`LOAN_DISBURSEMENT`/`MANUAL`), `JournalEntryStatus` (`POSTED`/`UNPOSTED_MISSING_MAPPING`).
- `Tenant`/`Account` back-relations added.
- Migration already applied to local dev DB and `npx prisma generate` run.

**Posting engine** — `apps/backend/src/lib/journal.ts` (new):
- `postSavingTransaction`, `postLoanDisbursement`, `postLoanPayment` — each resolves the tenant's `AccountMapping` for the relevant `transactionKind`(s) and writes a balanced `JournalEntry`.
- Missing mapping → entry stored with 0 lines, status `UNPOSTED_MISSING_MAPPING`. Never blocks the source SAV/LOAN transaction (Design Spec §3/§10 decision).
- Balance guard: `SUM(debit) = SUM(credit)` checked before every commit → `JOURNAL_ENTRY_UNBALANCED` (added to `apps/backend/src/lib/errors.ts`), 500, should never actually be reachable in normal operation.
- `splitPrincipalAndInterest()` — since SISKOP has no per-installment amortization schedule (`loan-calc.ts` only computes a flat total), a payment's principal/interest split is approximated via the loan's overall interest ratio applied to the payment amount. Documented assumption in the code comment — revisit if an amortization schedule ever gets built.

**Wiring** (all inside existing `prisma.$transaction` blocks — posting is atomic with the source write):
- `apps/backend/src/modules/savings/savings.service.ts`: `create()` (initial deposit), `deposit()`, `withdraw()`.
- `apps/backend/src/modules/loans/loans.service.ts`: `create()` (now wrapped in `prisma.$transaction`, posts `DISBURSEMENT`), `recordPayment()` (posts principal/interest/penalty as up to 3 mapped components in one entry — captured the previously-discarded `tx.loanPayment.create()` return value to get `payment.id` for `sourceId`).

**Tests**:
- `apps/backend/tests/journal.test.ts` (new) — 5 tests: unmapped transaction produces `UNPOSTED_MISSING_MAPPING` with 0 lines and doesn't block the saving; mapped deposit/withdrawal post balanced 2-line entries to the correct accounts; loan disbursement posts correctly; a payment with principal+interest+penalty all mapped produces a 6-line entry that balances overall and splits correctly.
- `apps/backend/tests/helpers/setup.ts`: `cleanupTenant()` now deletes `journalLine`/`journalEntry` before `accountMapping`/`account`/`tenant` (FK order) — was causing 2 unrelated test suites to fail teardown before this fix.
- **Status: 12/12 suites, 145/145 tests passing.** `npx tsc --noEmit` clean in `apps/backend`.

### Known incidental finding (not fixed, out of scope this session)

Exploration turned up a likely bug: `apps/backend/src/modules/reports/reports.service.ts` (RPT-01) returns a different response shape than what `apps/frontend/src/pages/reports/ReportsPage.tsx` expects to consume (financial report and RAT report both mismatched). Unrelated to the journal engine work — flagged for a separate look, not investigated further.

### Next steps (not started)

Per the design spec's recommended sequencing (`Docs/specs/2026-07-22-pelaporan-regulasi-design.md` §3, Product panel note):

1. **Neraca + Laporan Arus Kas** — read-only report endpoints aggregating `JournalLine` balances by `Account.category`/`normalBalance`. No new schema needed; logic is spec'd in §6.1/§6.3. Lowest risk next step since the ledger already exists.
2. **Laporan Perhitungan Hasil Usaha + Daftar Pembagian SHU per Anggota** — needs the `ShuDistributionConfig` model (spec §5.4, not yet created) plus report logic (§6.2/§6.4).
3. **CALK** — mostly narrative/rich-text with injected numeric sections (§6.5).
4. **Tenant.modalDisetor + audit-threshold (Rp5M) notification cron** (§5.3/§6.6) — independent of the above, can be done anytime.
5. **LPEA** — explicitly deferred, needs its own calculation spec first (§2, §14).

### Operational notes for the next session

- Nothing from this session is committed — `git status` will show the modified/untracked files listed above. Review and commit (or continue building) before starting Phase 3 work.
- Local dev `node.exe` processes were force-killed mid-session to unstick a locked Prisma engine DLL (`EPERM` on `prisma generate`). If dev servers aren't running, that's why — restart `pnpm dev` as needed.
