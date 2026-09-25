# Fix plan — Setoran Awal (branch `fixes/setoran-awal`)

## Context

"Setoran Awal" (opening deposit) today is one optional free-number field applied identically
to every saving product (`createSavingSchema.initialDeposit: min(0).default(0)`,
`savings/service.ts#createSaving`, `NewSavingPage.tsx` "Setoran Awal (opsional)").
That contradicts how koperasi savings work (UU 25/1992, AD/ART):

| Product | Correct concept | Current behaviour (origin/main) |
|---|---|---|
| **Pokok** | Fixed nominal set by AD/ART, same for every member, paid **once in full** at joining. Not topped up. Not withdrawable while member is active (refunded only on exit). | Any amount incl. **0**; no nominal exists on `SavingConfig`; extra deposits allowed; withdrawable to 0 when no active loan (D2). |
| **Wajib** | Fixed periodic nominal (e.g. monthly) set by AD/ART. | Any amount incl. 0; no nominal field. |
| **Sukarela** | Free amount, optional. | OK. |

Knock-on wrong concepts:
- A **0-balance Pokok** satisfies `hasPokokSaving()` (checks only `isActive`), so the loan gate
  (`loans/service.ts` `createLoan`) and Pokok prerequisite pass with zero equity paid.
- `createSaving` never checks Pokok prerequisite (QA **D1**) nor duplicates (QA **D3**) — a member
  can hold two Pokok accounts or Wajib without Pokok.
- Refs: `docs/qa-cycle2-2026-09-11/Bugs List.md` D1–D3, FR-SAV-02/05/06 in
  `docs/02-System-Requirements-SISKOP.md` (marked Implemented — stale).

Decisions (from user): Pokok = **fixed nominal**, exact amount at opening, no later top-ups.
Scope includes D1, D3, Wajib fixed nominal, D2.

## Step 0 — Branch (done)

```
git fetch origin
git switch -c fixes/setoran-awal origin/main
```
(Current branch `feature/riwayat-transaksi-new` has unmerged savings changes — work from main only;
expect a small merge in `savings/service.ts`/`schema.ts` whichever lands second.)

## Step 1 — Schema & types

- `apps/backend/prisma/schema.prisma` `model SavingConfig`: add
  `fixedAmount Decimal? @db.Decimal(15, 2)` — the AD/ART nominal (Pokok: one-time; Wajib: per period).
  Null for Sukarela.
- `model Saving`: add `@@unique([memberId, unitId, savingConfigId])` (D3).
- Migration `pnpm --filter @siskop/backend db:migrate` — name `savings_fixed_amount_unique`.
  Migration SQL must first **detect duplicates**; if any exist, fail with clear message rather than
  silently merging (dev DB: clean duplicates manually/document in PR). Note for ops in PR body.
- `packages/types/src/savings.ts`: `SavingConfig.fixedAmount: string | null`;
  `CreateSavingConfigRequest.fixedAmount?: number`; `CreateSavingRequest.initialDeposit` doc comment
  per type rule.
- `packages/types/src/api.ts` ErrorCode: add `SAVING_FIXED_AMOUNT_NOT_SET`,
  `INVALID_INITIAL_DEPOSIT`, `POKOK_ALREADY_PAID`. Reuse `CONFLICT`, `MEMBER_HAS_NO_POKOK_SAVING`,
  `CANNOT_WITHDRAW_POKOK`. Map statuses in `apps/backend/src/lib/errors.ts` (422 / 409).

## Step 2 — Config validation (`savings/schema.ts`, `savings/service.ts`)

- `createSavingConfigSchema`: `fixedAmount: z.coerce.number().positive().optional()`, `superRefine`
  → required when `type` is POKOK or WAJIB, forbidden/ignored for SUKARELA.
  Update schema: when editing, re-validate against the resulting type.
- `createSavingConfig` / `updateSavingConfig` persist `fixedAmount`.
- Changing Pokok `fixedAmount` affects only new accounts (existing balances untouched) — doc comment.
- `apps/backend/prisma/seed.ts` default configs: Pokok 500_000, Wajib 100_000.

## Step 3 — `createSaving` rules (`apps/backend/src/modules/savings/service.ts`)

Order inside the function (before `$transaction`):
1. Member + config lookup (unchanged, tenant-scoped).
2. **Duplicate** (D3): `findFirst({ tenantId, memberId, unitId, savingConfigId, isActive: true })` →
   `CONFLICT "Anggota sudah memiliki rekening untuk produk ini"`. Also catch Prisma P2002 in tx
   (race) → same CONFLICT (reuse existing `isUniqueViolation` pattern from `auth/service.ts`).
3. **Prerequisite** (D1): if `config.type !== "POKOK"` and `!hasPokokSaving(...)` →
   `MEMBER_HAS_NO_POKOK_SAVING`.
4. **Setoran awal per type**:
   - POKOK: `fixedAmount` null → `SAVING_FIXED_AMOUNT_NOT_SET`; `initialDeposit` must equal
     `fixedAmount` (compare via `Prisma.Decimal.equals`) → else `INVALID_INITIAL_DEPOSIT`.
     If client omits it, default to `fixedAmount`.
   - WAJIB: `fixedAmount` null → `SAVING_FIXED_AMOUNT_NOT_SET`; `initialDeposit` must be a positive
     multiple of `fixedAmount` (allows paying several periods upfront); default = `fixedAmount`.
   - SUKARELA: unchanged (≥ 0, optional).
- Make `initialDeposit` optional in `createSavingSchema` (drop `.default(0)`) so the service can
  default per type.
- Journal/transaction posting path unchanged (`postSavingTransaction`, note "Setoran awal").
- `hasPokokSaving`: additionally require `balance > 0` so a legacy 0-balance Pokok no longer
  counts as paid equity (affects loan gate too — intended).

## Step 4 — Deposit / withdraw rules

- `depositToSaving`: include `savingConfig`; POKOK → reject `POKOK_ALREADY_PAID` when
  balance ≥ `fixedAmount` (allows completing a legacy under-paid Pokok up to exactly the nominal,
  never above). WAJIB: amount must be a positive multiple of `fixedAmount` when set.
- `withdrawFromSaving` (D2): POKOK → always `CANNOT_WITHDRAW_POKOK` while `member.isActive`
  ("Simpanan pokok hanya dikembalikan saat anggota keluar"). Existing active-loan check becomes
  redundant for Pokok — remove it. Refund-on-exit flow (`members/service.ts#deactivateMember`)
  is **out of scope** — note as follow-up.

## Step 5 — Frontend

- `apps/frontend/src/pages/config/SavingConfigsTab.tsx`: "Nominal (Rp) *" input shown for
  POKOK/WAJIB (label "Nominal per periode" for Wajib); column in table.
- `apps/frontend/src/pages/savings/NewSavingPage.tsx`: on config select —
  POKOK: Setoran Awal read-only = nominal, helper text "Dibayar sekali sesuai AD/ART";
  WAJIB: prefilled nominal, step = nominal; SUKARELA: optional as today. Surface API errors.
- `apps/frontend/src/pages/savings/SavingDetailPage.tsx`: hide/disable Setor + Tarik on Pokok
  (show explanatory text replacing current "tidak dapat ditarik jika ada pinjaman aktif").
- Mobile staff app (`apps/mobile/src/pages/savings/SavingDetailPage.tsx`): same button gating.

## Step 6 — Tests (TDD — write failing first, `apps/backend/tests/savings.test.ts`, `config.test.ts`)

- Config: POKOK/WAJIB without `fixedAmount` → 400; SUKARELA without → 201.
- Pokok opening: 0 / less / more than nominal → 422 `INVALID_INITIAL_DEPOSIT`; exact → 201 +
  balanced journal; omitted → defaults to nominal; config w/o nominal → `SAVING_FIXED_AMOUNT_NOT_SET`.
- Wajib: non-multiple → 422; 2× nominal → 201.
- D1: Wajib/Sukarela before Pokok → 422 `MEMBER_HAS_NO_POKOK_SAVING`.
- D3: second account same product → 409 `CONFLICT`; different tenant unaffected.
- Deposit to paid Pokok → `POKOK_ALREADY_PAID`. Withdraw Pokok (no loan) → `CANNOT_WITHDRAW_POKOK`.
- `hasPokokSaving` false for 0-balance Pokok → loan creation 422.
- **Fixture sweep**: many tests open savings with arbitrary `initialDeposit` / skip Pokok
  (`tests/helpers.ts:39`, `member-portal`, `reports`, `scheduler`, `journal-unit`,
  `konsumen-credit`, `toko-accounting`, `config`). Update helpers to create configs with
  `fixedAmount` and open Pokok first; prefer a shared helper `openPokok(member)` in
  `tests/helpers.ts`. Scheduler interest tests should use SUKARELA configs.
- Scripts/seeds using `createSaving` (`prisma/seed-ksu-demo.ts`, `prisma/seed-demo-transactions.mjs`,
  `scripts/import-kopkar-umsurabaya.ts`): set config nominals; the import script loads
  historical Pokok+Wajib totals — give it an explicit `bypassSetoranAwalRules` internal option
  (service-level param, not exposed via HTTP schema) so migrations still import real balances.

## Step 7 — Docs

- `docs/02-System-Requirements-SISKOP.md`: FR-SAV-02/05/06 status + new FR for fixed nominal.
- `docs/qa-cycle2-2026-09-11/Bugs List.md`: mark D1–D3 fixed (D2 per new rule) referencing branch.
- `docs/05-DB-Schema-SISKOP.md`: `fixedAmount`, unique constraint.

## Verification

1. `pnpm --filter @siskop/backend db:migrate` on local Postgres (port 5433).
2. `pnpm run test` (backend coverage ≥ 80%), `pnpm run lint`, `pnpm run typecheck`.
3. Manual (`pnpm run dev`, `demo.localhost:3000`): set Pokok nominal in Konfigurasi → open Pokok
   (field locked to nominal) → open Wajib (prefilled) → try second Pokok (409) → try Setor/Tarik on
   Pokok (blocked) → create loan for member with paid Pokok (OK) and for member without (422).
4. Commit per step with conventional commits (`feat(savings): …`, `fix(savings): …`).

## Out of scope / follow-ups

- Pokok refund on member exit (`deactivateMember`) — needs journal + product decision.
- Pokok/Wajib accruing interest via daily scheduler (conceptually they share in SHU, not bunga) —
  separate ticket.
- Wajib period tracking / arrears (tunggakan wajib) billing.
