# Beban Umum (general expense entry) — design

Date: 2026-09-27
Branch: feature/beban-umum

## Goal

Let a cooperative admin record general administrative expenses (salary, rent,
office supplies, etc) directly in the app. Today there is no UI/API for this —
only seed scripts insert `MANUAL` journal entries directly into the DB.

## Decisions (confirmed with user)

1. **No entitlement gate.** Available to every tenant regardless of
   subscription package — not restricted like COA/Mappings/SHU/Laporan
   Regulasi (the "accounting" add-on).
2. **COA auto-provisioned for every tenant at creation.** Base tenants
   currently get zero `Account` rows until someone manually clicks "Generate
   Standard COA" on the gated Konfigurasi page. That blocks this feature, so
   COA generation moves into tenant provisioning, unconditionally.
3. **Standalone top-level page**, not a Konfigurasi tab — it's a recurring
   transaction like Simpanan/Pinjaman, not a settings screen.
4. **Optional unit picker** — multi-unit tenants can attribute an expense to
   one `CooperativeUnit`; default is tenant-level (`unitId = null`, the
   unallocated bucket per CLAUDE.md rule 2b).
5. **Delete only, no edit.** A mistake is deleted and re-entered. No
   period-lock concept exists in this codebase, so nothing else blocks this;
   matches the fact that no other journal-producing flow supports correction
   either.
6. **Credit side restricted to cash-equivalent accounts** (`Account.isCashEquivalent
   = true`, i.e. Kas/Bank). Beban Umum always means cash/bank leaving the
   coop — non-cash/accrued expenses are out of scope.

## Data model

No new tables. Reuses `Account` (`category = BEBAN` already exists in
`AccountCategory`) and `JournalEntry` + `JournalLine` (`MANUAL` sourceType
already exists).

**New enum value:** `JournalSourceType += MANUAL_EXPENSE`. Kept distinct from
the generic `MANUAL` value (used by scripts for equity injections etc.) so
Beban Umum's list/delete endpoints can filter and own exactly the entries this
feature created, without accidentally touching unrelated manual entries.

**New permission module:** `Permissions.expenses?: ModulePermissions` in
`packages/types/src/role.ts`, following the same optional pattern as
`accounting`/`konsumen`/`auditLog` (so old seeded role JSON blobs still
parse).

## Provisioning change

`generateStandardCoa(tenantId)` in `modules/config/service.ts` currently opens
its own `db.$transaction`. Extract the body into
`generateStandardCoaInTx(tx: TxClient, tenantId: string)`; the existing
function becomes a thin wrapper:

```ts
export async function generateStandardCoa(tenantId: string) {
  return db.$transaction((tx) => generateStandardCoaInTx(tx, tenantId));
}
```

`provisionTenantInTx()` (`modules/tenants/provision.ts`) calls
`generateStandardCoaInTx(tx, tenant.id)` right after creating
`CooperativeUnit` rows (the template's `isMultiUnit`/`unitType` branches need
units to already exist). This runs for every tenant, through every existing
call site (`auth/service.ts`, `platform/service.ts`, `onboarding/service.ts`)
with no call-site changes needed.

Already idempotent — safe with the existing gated
`POST /config/accounts/generate-standard` route, which stays gated and keeps
working exactly as before (calling it again just skips existing accounts).
Checked `config.test.ts`/`toko-accounting.test.ts`/`reports.test.ts`: their
entitlement-gate assertions test the *route*, not DB state, so none break.

Side effect (acceptable, not the goal): base tenants' Savings/Loans/POS
journal entries stop permanently sitting as `UNPOSTED_MISSING_MAPPING` — they
get real accounts to map against too.

`SEED_ROLES` in the same file get an `expenses` entry:

| Role | expenses permission |
|---|---|
| Super Admin | FULL |
| Manager | FULL |
| Teller | `{}` |
| Viewer | READ_ONLY |
| Kasir | `{}` |

`RolesTab.tsx`'s `MODULES` array gets `{ key: "expenses", label: "Beban Umum" }`
so tenant admins can adjust this on custom roles too.

## Backend

New module `apps/backend/src/modules/expenses/` (routes.ts / schema.ts /
service.ts, same triple as every other module).

`lib/journal.ts` gets a new `postManualExpense(tx, params)` alongside the
existing `postSavingTransaction`/`postLoanPayment`/etc helpers. Extends
`createJournalEntry`'s internal `sourceType` union with `"MANUAL_EXPENSE"`.
Always produces exactly 2 balanced lines (debit expense, credit cash) — never
`UNPOSTED_MISSING_MAPPING`.

Routes (all `requireAuth` + `requirePermission("expenses", action)`, **no**
`requireAccountingEntitlement`):

- `GET /api/expenses` — list, filterable by date range and `unitId`
- `POST /api/expenses` — create
- `DELETE /api/expenses/:id` — delete (only entries with
  `sourceType === "MANUAL_EXPENSE"`; JournalLine cascade-deletes automatically)
- `GET /api/expenses/accounts` — `{ debitAccounts, creditAccounts }` picker
  data (BEBAN accounts / cash-equivalent accounts respectively) — deliberately
  a separate, ungated endpoint from `/config/accounts`

`createExpense` validation (service-layer, tenant-scoped per CLAUDE.md rule 1):
- `debitAccount.tenantId === callerTenantId && category === "BEBAN" && isActive`
- `creditAccount.tenantId === callerTenantId && isCashEquivalent === true && isActive`
- `amount > 0` (Decimal, never Float — CLAUDE.md rule 2)
- `unitId` (if provided) belongs to caller's tenant

## Types (`packages/types/src/expenses.ts`, new file)

```ts
export interface ExpenseEntry {
  id: string;
  entryDate: string;
  description: string;
  amount: string; // Decimal serialized as string
  debitAccountId: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountName: string;
  unitId: string | null;
  unitName: string | null;
  createdAt: string;
}

export interface CreateExpenseRequest {
  entryDate: string;
  description: string;
  amount: string;
  debitAccountId: string;
  creditAccountId: string;
  unitId?: string;
}

export interface ExpenseAccountsResponse {
  debitAccounts: Account[];  // category = BEBAN
  creditAccounts: Account[]; // isCashEquivalent = true
}
```

Exported from `packages/types/src/index.ts`.

## Frontend

New standalone page, not a Konfigurasi tab.

- `apps/frontend/src/pages/expenses/ExpensesPage.tsx`: `DataTable` (Tanggal,
  Keterangan, Akun Beban, Akun Kredit, Unit, Jumlah, Aksi) + "Catat Beban"
  button opening a `Dialog` form. Form: react-hook-form + zod, fields = date,
  description, debit-account `Select` (from `/api/expenses/accounts`
  `debitAccounts`), credit-account `Select` (`creditAccounts`), optional unit
  `Select` (default "Semua Unit / Tenant"), amount (Rupiah-formatted input).
  Delete via `ConfirmDialog`. Follows `AccountMappingsTab.tsx` conventions
  (`apiFetch`/`apiPost`/`apiDelete`, `usePermissions`, `FormError`).
- Route `/expenses` registered in `App.tsx`, gated on `can("expenses","read")`.
- `Sidebar.tsx`: new top-level nav item (own icon, e.g. `Wallet`), gated the
  same way.

No edit UI — delete + re-create.

## Testing

`apps/backend/tests/expenses.test.ts` (TDD — written first):
- create success → balanced `JournalEntry` with `sourceType = MANUAL_EXPENSE`,
  correct debit/credit accounts and amounts
- reject debit account that isn't `BEBAN` category
- reject credit account that isn't `isCashEquivalent`
- reject an account id belonging to another tenant
- unit filter on list; entries default to `unitId = null`
- delete removes the entry and its lines (cascade)
- delete rejects an id whose `sourceType !== MANUAL_EXPENSE` (can't delete
  other journal entries through this endpoint)
- 403 for a role without `expenses` permission (e.g. Kasir/Teller)
- a freshly provisioned tenant (no package) already has BEBAN + Kas accounts
  available via `GET /api/expenses/accounts`, with no entitlement error

Existing suites (`config.test.ts`, `toko-accounting.test.ts`, `reports.test.ts`)
checked for COA-provisioning-order assumptions — none found; their entitlement
assertions are route-level, unaffected.

## Out of scope (explicitly deferred)

- Editing an existing expense entry
- Non-cash/accrued expenses (crediting a payable instead of Kas/Bank)
- Multi-line entries (splitting one payment across several BEBAN accounts)
- Period locking / closing (doesn't exist anywhere in this codebase yet)
