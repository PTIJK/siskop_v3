# Beban Umum (general expense entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cooperative admin record general administrative expenses (salary, rent, office supplies) as a real GL journal entry, available to every tenant regardless of subscription package.

**Architecture:** Reuse the existing `Account`/`JournalEntry`/`JournalLine` ledger with a new `MANUAL_EXPENSE` sourceType — no new tables. Auto-provision the standard Chart of Accounts for every tenant at creation (currently only available behind a paid, manually-triggered button) so a real `BEBAN` account and `Kas` account exist from day one. New `expenses` RBAC module, ungated by the "accounting" package entitlement.

**Tech Stack:** Express + Prisma (Postgres) backend, zod validation, React + react-hook-form + TanStack Query frontend, Vitest + Supertest tests.

**Design doc:** `docs/2026-09-27-beban-umum-design.md` (read first if anything below is unclear on *why*).

---

## Important: why Task 5 exists

Auto-provisioning the standard COA for every tenant (Task 4) is not free: several existing backend tests manually create `Account` rows using the *same codes* the standard template uses (e.g. `1-1000` for Kas), to simulate "a tenant that built its own COA by hand." Once every tenant already has those codes from provisioning, those manual creates 409-conflict (the `Account` model has `@@unique([tenantId, code])`). Task 5 fixes every one of these — it was found by grep, not guessed, and the exact fix for each spot is spelled out. Do not skip it; skipping it leaves the existing suite red.

---

### Task 1: Add `MANUAL_EXPENSE` to the `JournalSourceType` enum

**Files:**
- Modify: `apps/backend/prisma/schema.prisma:131-141`

- [ ] **Step 1: Edit the enum**

Find:
```prisma
enum JournalSourceType {
  SAVING_TRANSACTION
  LOAN_PAYMENT
  LOAN_DISBURSEMENT
  POS_SALE
  MEMBER_CREDIT_REPAYMENT
  MANUAL
  // A restock (StockMovement IN). ADJUSTMENT movements are not journaled: they *set* the
  // count and the previous quantity isn't stored, so the delta can't be recovered.
  STOCK_MOVEMENT
}
```

Replace with:
```prisma
enum JournalSourceType {
  SAVING_TRANSACTION
  LOAN_PAYMENT
  LOAN_DISBURSEMENT
  POS_SALE
  MEMBER_CREDIT_REPAYMENT
  MANUAL
  // Beban Umum (general expense entry) — see modules/expenses. Kept distinct
  // from MANUAL so its list/delete endpoints own exactly the entries this
  // feature created, without touching other ad-hoc manual entries.
  MANUAL_EXPENSE
  // A restock (StockMovement IN). ADJUSTMENT movements are not journaled: they *set* the
  // count and the previous quantity isn't stored, so the delta can't be recovered.
  STOCK_MOVEMENT
}
```

- [ ] **Step 2: Confirm `DATABASE_URL` points at your local dev DB, not staging**

Check `apps/backend/.env`'s `DATABASE_URL` — must point at `localhost:5433` (the local Postgres container), not the Cloud SQL staging proxy. If it points at staging, override for this command only rather than editing the file (see memory: dev environment / staging DB access notes).

- [ ] **Step 3: Stop the backend dev server if it's running**

Windows `prisma migrate dev` EPERMs on the query engine DLL if `tsx watch` still holds it open.

- [ ] **Step 4: Generate and apply the migration**

Run: `pnpm --filter @siskop/backend db:migrate -- --name add_manual_expense_source_type`
Expected: prints a new migration folder under `apps/backend/prisma/migrations/`, ends with "Your database is now in sync with your schema."

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations
git commit -m "feat(db): add MANUAL_EXPENSE journal source type for Beban Umum"
```

---

### Task 2: `packages/types` — permission, wire types

**Files:**
- Modify: `packages/types/src/role.ts`
- Create: `packages/types/src/expenses.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the `expenses` permission module**

In `packages/types/src/role.ts`, find:
```ts
  accounting?: ModulePermissions;
  // Phase 2 (KSU Konsumen/Toko) — optional like `accounting` above, so a role
  // permissions blob seeded before this module existed still parses.
  konsumen?: ModulePermissions;
  // User-activity audit trail — optional like `accounting`/`konsumen` above.
  // Only `read` is ever seeded (AuditLog rows are never user-editable).
  auditLog?: ModulePermissions;
}
```

Replace with:
```ts
  accounting?: ModulePermissions;
  // Phase 2 (KSU Konsumen/Toko) — optional like `accounting` above, so a role
  // permissions blob seeded before this module existed still parses.
  konsumen?: ModulePermissions;
  // User-activity audit trail — optional like `accounting`/`konsumen` above.
  // Only `read` is ever seeded (AuditLog rows are never user-editable).
  auditLog?: ModulePermissions;
  // Beban Umum (general expense entry) — optional like the modules above,
  // and deliberately NOT gated by the "accounting" package entitlement: see
  // docs/2026-09-27-beban-umum-design.md. `update` is never seeded — an
  // entry is deleted and re-entered, not edited in place.
  expenses?: ModulePermissions;
}
```

- [ ] **Step 2: Create the wire types**

Create `packages/types/src/expenses.ts`:
```ts
import type { Account } from "./accounting.js";

export interface ExpenseEntry {
  id: string;
  entryDate: string;
  description: string;
  amount: string;
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
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
  unitId?: string;
}

export interface ExpenseAccountsResponse {
  /** BEBAN-category, active accounts — the debit side. */
  debitAccounts: Account[];
  /** Cash-equivalent, active accounts — the credit side. */
  creditAccounts: Account[];
}
```

- [ ] **Step 3: Export it**

In `packages/types/src/index.ts`, add at the end:
```ts
export * from "./expenses.js";
```

- [ ] **Step 4: Build the types package**

Backend/frontend resolve `@siskop/types` via its compiled `dist/` (package.json `main`/`types` point there, and neither consumer's tsconfig path-maps to `src`) — editing `.ts` source alone is invisible to them until rebuilt.

Run: `pnpm --filter @siskop/types build`
Expected: no errors; `packages/types/dist` now includes `expenses.js`/`expenses.d.ts` and the updated `role.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/role.ts packages/types/src/expenses.ts packages/types/src/index.ts
git commit -m "feat(types): add expenses permission module and ExpenseEntry wire types"
```

---

### Task 3: Refactor `generateStandardCoa` to be callable inside an existing transaction

**Why:** Task 4 needs to run COA generation inside `provisionTenantInTx`'s own transaction, but today `generateStandardCoa` always opens its own `db.$transaction`. Split the body out into a `tx`-taking function; the existing function becomes a one-line wrapper. Behavior is unchanged — this is a pure refactor, verified by the existing test suite (still red until Task 5, but not because of this task).

**Files:**
- Modify: `apps/backend/src/modules/config/service.ts:235-396`

- [ ] **Step 1: Replace the function**

Find (the full function, lines 235-396):
```ts
export async function generateStandardCoa(tenantId: string): Promise<GenerateStandardCoaResult> {
  return db.$transaction(async (tx: TxClient) => {
    const existingAccounts = await tx.account.findMany({ where: { tenantId } });
    const idByCode = new Map(existingAccounts.map((a) => [a.code, a.id]));

    // Classify a pre-existing template EKUITAS account the tenant left
    // unclassified (created before equityClass existed). Matched on code AND
    // name: the same code can hold something else entirely (seed-ksu-demo.ts's
    // 3-1000 is "Modal Kerja"), and a wrong class would silently skew Modal
    // Sendiri — an unclassified account is left for an admin instead. Never
    // overrides a class the tenant chose.
    for (const account of existingAccounts) {
      if (account.category !== "EKUITAS" || account.equityClass !== null) continue;
      const seed = COA_TEMPLATE.find((t) => t.code === account.code && t.name === account.name);
      if (!seed?.equityClass) continue;
      await tx.account.update({ where: { id: account.id, tenantId }, data: { equityClass: seed.equityClass } });
    }

    let accountsCreated = 0;
    let accountsSkipped = 0;

    async function createTemplateAccount(acc: AccountSeed): Promise<string> {
      const parentCode = acc.parentKey ? COA_TEMPLATE.find((t) => t.key === acc.parentKey)?.code : undefined;
      const parentId = parentCode ? idByCode.get(parentCode) : undefined;
      const created = await tx.account.create({
        data: {
          tenantId,
          code: acc.code,
          name: acc.name,
          category: acc.category,
          normalBalance: acc.normalBalance,
          isHeader: acc.isHeader ?? false,
          isCashEquivalent: acc.isCashEquivalent ?? false,
          equityClass: acc.equityClass ?? null,
          isDefault: true,
          isActive: true,
          ...(parentId ? { parentId } : {})
        }
      });
      idByCode.set(acc.code, created.id);
      return created.id;
    }

    const isMultiUnit = (await tx.cooperativeUnit.count({ where: { tenantId, isActive: true } })) > 1;
    for (const acc of COA_TEMPLATE) {
      // Unit-specific (Toko) accounts are handled below, only when the tenant has such a unit.
      if (acc.unitType) continue;
      if (acc.multiUnitOnly && !isMultiUnit) continue;
      if (idByCode.has(acc.code)) {
        accountsSkipped += 1;
        continue;
      }
      await createTemplateAccount(acc);
      accountsCreated += 1;
    }

    const accountIdFor = (key: string): string => {
      const code = COA_TEMPLATE.find((t) => t.key === key)?.code;
      const id = code && idByCode.get(code);
      if (!id) throw new Error(`Standard COA template is missing required account "${key}"`);
      return id;
    };

    const kas = accountIdFor("kas");
    const piutang = accountIdFor("piutang_pinjaman");
    const pendapatanBunga = accountIdFor("pendapatan_bunga");
    const pendapatanLain = accountIdFor("pendapatan_lain");
    const equityOrLiabilityBySavingType: Record<string, string> = {
      POKOK: accountIdFor("simpanan_pokok"),
      WAJIB: accountIdFor("simpanan_wajib"),
      SUKARELA: accountIdFor("simpanan_sukarela")
    };

    const [savingConfigs, loanConfigs] = await Promise.all([
      tx.savingConfig.findMany({ where: { tenantId }, select: { id: true, type: true } }),
      tx.loanConfig.findMany({ where: { tenantId }, select: { id: true } })
    ]);

    let mappingsCreated = 0;
    let mappingsSkipped = 0;

    async function ensureMapping(
      sourceType: "SAVING_CONFIG" | "LOAN_CONFIG",
      sourceId: string,
      transactionKind: "DEPOSIT" | "WITHDRAWAL" | "DISBURSEMENT" | "PAYMENT_PRINCIPAL" | "PAYMENT_INTEREST" | "PAYMENT_PENALTY",
      debitAccountId: string,
      creditAccountId: string
    ) {
      const existing = await tx.accountMapping.findFirst({ where: { tenantId, sourceType, sourceId, transactionKind } });
      if (existing) {
        mappingsSkipped += 1;
        return;
      }
      await tx.accountMapping.create({ data: { tenantId, sourceType, sourceId, transactionKind, debitAccountId, creditAccountId } });
      mappingsCreated += 1;
    }

    for (const config of savingConfigs) {
      const equityOrLiability = equityOrLiabilityBySavingType[config.type];
      if (!equityOrLiability) continue;
      await ensureMapping("SAVING_CONFIG", config.id, "DEPOSIT", kas, equityOrLiability);
      await ensureMapping("SAVING_CONFIG", config.id, "WITHDRAWAL", equityOrLiability, kas);
    }

    for (const config of loanConfigs) {
      await ensureMapping("LOAN_CONFIG", config.id, "DISBURSEMENT", piutang, kas);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PRINCIPAL", kas, piutang);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_INTEREST", kas, pendapatanBunga);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PENALTY", kas, pendapatanLain);
    }

    // Toko: only for a tenant that has an active KONSUMEN unit. Lazy per
    // mapping — a tenant that already wired a SYSTEM/SALE_* mapping by hand (to
    // its own accounts) must not get a second, unused set of Toko accounts, so
    // accounts are only created for a mapping that doesn't exist yet.
    const hasKonsumenUnit = (await tx.cooperativeUnit.count({ where: { tenantId, type: "KONSUMEN", isActive: true } })) > 0;
    if (hasKonsumenUnit) {
      const tokoAccountIds = new Map<string, string>();
      const resolveAccount = async (key: string): Promise<string> => {
        const seed = COA_TEMPLATE.find((t) => t.key === key);
        if (!seed?.unitType) return accountIdFor(key);

        const known = tokoAccountIds.get(key);
        if (known) return known;
        let id = idByCode.get(seed.code);
        if (id) {
          accountsSkipped += 1;
        } else {
          id = await createTemplateAccount(seed);
          accountsCreated += 1;
        }
        tokoAccountIds.set(key, id);
        return id;
      };

      for (const template of SYSTEM_MAPPING_TEMPLATE) {
        const existing = await tx.accountMapping.findFirst({
          where: { tenantId, sourceType: "SYSTEM", sourceId: null, transactionKind: template.transactionKind }
        });
        if (existing) {
          mappingsSkipped += 1;
          continue;
        }
        const debitAccountId = await resolveAccount(template.debitKey);
        const creditAccountId = await resolveAccount(template.creditKey);
        await tx.accountMapping.create({
          data: {
            tenantId,
            sourceType: "SYSTEM",
            sourceId: null,
            transactionKind: template.transactionKind,
            debitAccountId,
            creditAccountId
          }
        });
        mappingsCreated += 1;
      }
    }

    return { accountsCreated, accountsSkipped, mappingsCreated, mappingsSkipped };
  });
}
```

Replace with (same logic, lifted out of the `db.$transaction` callback so it can run inside a caller-supplied transaction — every line below is identical to above except the outer wrapper, and a thin wrapper is added after it):
```ts
export async function generateStandardCoaInTx(tx: TxClient, tenantId: string): Promise<GenerateStandardCoaResult> {
  const existingAccounts = await tx.account.findMany({ where: { tenantId } });
  const idByCode = new Map(existingAccounts.map((a) => [a.code, a.id]));

  // Classify a pre-existing template EKUITAS account the tenant left
  // unclassified (created before equityClass existed). Matched on code AND
  // name: the same code can hold something else entirely (seed-ksu-demo.ts's
  // 3-1000 is "Modal Kerja"), and a wrong class would silently skew Modal
  // Sendiri — an unclassified account is left for an admin instead. Never
  // overrides a class the tenant chose.
  for (const account of existingAccounts) {
    if (account.category !== "EKUITAS" || account.equityClass !== null) continue;
    const seed = COA_TEMPLATE.find((t) => t.code === account.code && t.name === account.name);
    if (!seed?.equityClass) continue;
    await tx.account.update({ where: { id: account.id, tenantId }, data: { equityClass: seed.equityClass } });
  }

  let accountsCreated = 0;
  let accountsSkipped = 0;

  async function createTemplateAccount(acc: AccountSeed): Promise<string> {
    const parentCode = acc.parentKey ? COA_TEMPLATE.find((t) => t.key === acc.parentKey)?.code : undefined;
    const parentId = parentCode ? idByCode.get(parentCode) : undefined;
    const created = await tx.account.create({
      data: {
        tenantId,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normalBalance: acc.normalBalance,
        isHeader: acc.isHeader ?? false,
        isCashEquivalent: acc.isCashEquivalent ?? false,
        equityClass: acc.equityClass ?? null,
        isDefault: true,
        isActive: true,
        ...(parentId ? { parentId } : {})
      }
    });
    idByCode.set(acc.code, created.id);
    return created.id;
  }

  const isMultiUnit = (await tx.cooperativeUnit.count({ where: { tenantId, isActive: true } })) > 1;
  for (const acc of COA_TEMPLATE) {
    // Unit-specific (Toko) accounts are handled below, only when the tenant has such a unit.
    if (acc.unitType) continue;
    if (acc.multiUnitOnly && !isMultiUnit) continue;
    if (idByCode.has(acc.code)) {
      accountsSkipped += 1;
      continue;
    }
    await createTemplateAccount(acc);
    accountsCreated += 1;
  }

  const accountIdFor = (key: string): string => {
    const code = COA_TEMPLATE.find((t) => t.key === key)?.code;
    const id = code && idByCode.get(code);
    if (!id) throw new Error(`Standard COA template is missing required account "${key}"`);
    return id;
  };

  const kas = accountIdFor("kas");
  const piutang = accountIdFor("piutang_pinjaman");
  const pendapatanBunga = accountIdFor("pendapatan_bunga");
  const pendapatanLain = accountIdFor("pendapatan_lain");
  const equityOrLiabilityBySavingType: Record<string, string> = {
    POKOK: accountIdFor("simpanan_pokok"),
    WAJIB: accountIdFor("simpanan_wajib"),
    SUKARELA: accountIdFor("simpanan_sukarela")
  };

  const [savingConfigs, loanConfigs] = await Promise.all([
    tx.savingConfig.findMany({ where: { tenantId }, select: { id: true, type: true } }),
    tx.loanConfig.findMany({ where: { tenantId }, select: { id: true } })
  ]);

  let mappingsCreated = 0;
  let mappingsSkipped = 0;

  async function ensureMapping(
    sourceType: "SAVING_CONFIG" | "LOAN_CONFIG",
    sourceId: string,
    transactionKind: "DEPOSIT" | "WITHDRAWAL" | "DISBURSEMENT" | "PAYMENT_PRINCIPAL" | "PAYMENT_INTEREST" | "PAYMENT_PENALTY",
    debitAccountId: string,
    creditAccountId: string
  ) {
    const existing = await tx.accountMapping.findFirst({ where: { tenantId, sourceType, sourceId, transactionKind } });
    if (existing) {
      mappingsSkipped += 1;
      return;
    }
    await tx.accountMapping.create({ data: { tenantId, sourceType, sourceId, transactionKind, debitAccountId, creditAccountId } });
    mappingsCreated += 1;
  }

  for (const config of savingConfigs) {
    const equityOrLiability = equityOrLiabilityBySavingType[config.type];
    if (!equityOrLiability) continue;
    await ensureMapping("SAVING_CONFIG", config.id, "DEPOSIT", kas, equityOrLiability);
    await ensureMapping("SAVING_CONFIG", config.id, "WITHDRAWAL", equityOrLiability, kas);
  }

  for (const config of loanConfigs) {
    await ensureMapping("LOAN_CONFIG", config.id, "DISBURSEMENT", piutang, kas);
    await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PRINCIPAL", kas, piutang);
    await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_INTEREST", kas, pendapatanBunga);
    await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PENALTY", kas, pendapatanLain);
  }

  // Toko: only for a tenant that has an active KONSUMEN unit. Lazy per
  // mapping — a tenant that already wired a SYSTEM/SALE_* mapping by hand (to
  // its own accounts) must not get a second, unused set of Toko accounts, so
  // accounts are only created for a mapping that doesn't exist yet.
  const hasKonsumenUnit = (await tx.cooperativeUnit.count({ where: { tenantId, type: "KONSUMEN", isActive: true } })) > 0;
  if (hasKonsumenUnit) {
    const tokoAccountIds = new Map<string, string>();
    const resolveAccount = async (key: string): Promise<string> => {
      const seed = COA_TEMPLATE.find((t) => t.key === key);
      if (!seed?.unitType) return accountIdFor(key);

      const known = tokoAccountIds.get(key);
      if (known) return known;
      let id = idByCode.get(seed.code);
      if (id) {
        accountsSkipped += 1;
      } else {
        id = await createTemplateAccount(seed);
        accountsCreated += 1;
      }
      tokoAccountIds.set(key, id);
      return id;
    };

    for (const template of SYSTEM_MAPPING_TEMPLATE) {
      const existing = await tx.accountMapping.findFirst({
        where: { tenantId, sourceType: "SYSTEM", sourceId: null, transactionKind: template.transactionKind }
      });
      if (existing) {
        mappingsSkipped += 1;
        continue;
      }
      const debitAccountId = await resolveAccount(template.debitKey);
      const creditAccountId = await resolveAccount(template.creditKey);
      await tx.accountMapping.create({
        data: {
          tenantId,
          sourceType: "SYSTEM",
          sourceId: null,
          transactionKind: template.transactionKind,
          debitAccountId,
          creditAccountId
        }
      });
      mappingsCreated += 1;
    }
  }

  return { accountsCreated, accountsSkipped, mappingsCreated, mappingsSkipped };
}

/** Thin wrapper for the HTTP route (`POST /config/accounts/generate-standard`), which has no transaction of its own to join. */
export async function generateStandardCoa(tenantId: string): Promise<GenerateStandardCoaResult> {
  return db.$transaction((tx) => generateStandardCoaInTx(tx, tenantId));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @siskop/backend typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/config/service.ts
git commit -m "refactor(config): extract generateStandardCoaInTx so provisioning can call it in-transaction"
```

---

### Task 4: Auto-provision COA + `expenses` permission at tenant creation

**Files:**
- Modify: `apps/backend/src/modules/tenants/provision.ts`
- Modify: `apps/frontend/src/pages/config/RolesTab.tsx:17-29` (do this now too — small, same permission)

- [ ] **Step 1: Import `generateStandardCoaInTx`**

In `apps/backend/src/modules/tenants/provision.ts`, find:
```ts
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Permissions } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { CooperativeType } from "@siskop/types";
import { parseSlug } from "../tenant-domains/policy.js";
```

Replace with:
```ts
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Permissions } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { CooperativeType } from "@siskop/types";
import { parseSlug } from "../tenant-domains/policy.js";
import { generateStandardCoaInTx } from "../config/service.js";
```

- [ ] **Step 2: Add `expenses` to every seed role**

Find each of these 5 blocks in `SEED_ROLES` and add the noted line right after `auditLog`:

Super Admin — after `auditLog: READ_ONLY` add `,\n      expenses: FULL`:
```ts
  {
    name: "Super Admin",
    permissions: {
      dashboard: READ_ONLY,
      members: FULL,
      savings: FULL,
      loans: FULL,
      reports: { read: true, export: true, update: true },
      config: { read: true, update: true },
      users: FULL,
      roles: FULL,
      accounting: FULL,
      konsumen: FULL,
      auditLog: READ_ONLY,
      expenses: FULL
    }
  },
```

Manager — same, `expenses: FULL`:
```ts
  {
    name: "Manager",
    permissions: {
      dashboard: READ_ONLY,
      members: FULL,
      savings: FULL,
      loans: FULL,
      reports: { read: true, export: true, update: true },
      config: { read: true, update: false },
      users: { create: false, read: true, update: false, delete: false },
      roles: { read: true },
      accounting: { create: false, read: false, update: false, delete: false },
      konsumen: FULL,
      auditLog: READ_ONLY,
      expenses: FULL
    }
  },
```

Teller — `expenses: {}`:
```ts
  {
    name: "Teller",
    permissions: {
      dashboard: READ_ONLY,
      members: READ_ONLY,
      savings: { create: true, read: true, update: true, delete: false },
      loans: { read: true, update: true },
      reports: {},
      config: {},
      users: {},
      roles: {},
      // Front-counter staff record stock movements and ring up POS sales
      // (create) but don't add/remove SKUs — that's Manager territory.
      konsumen: { create: true, read: true, update: true },
      auditLog: {},
      expenses: {}
    }
  },
```

Viewer — `expenses: READ_ONLY`:
```ts
  {
    name: "Viewer",
    permissions: {
      dashboard: READ_ONLY,
      members: READ_ONLY,
      savings: READ_ONLY,
      loans: READ_ONLY,
      reports: READ_ONLY,
      config: {},
      users: {},
      roles: {},
      konsumen: READ_ONLY,
      auditLog: {},
      expenses: READ_ONLY
    }
  },
```

Kasir — `expenses: {}`:
```ts
  {
    name: "Kasir",
    permissions: {
      // Toko-only: konsumen access and nothing else. No members/savings/loans/
      // reports/config/users/roles/accounting/auditLog — a Kasir cannot
      // reach any other module's data even before unit scoping is considered.
      dashboard: READ_ONLY,
      members: {},
      savings: {},
      loans: {},
      reports: {},
      config: {},
      users: {},
      roles: {},
      konsumen: { create: true, read: true, update: true },
      auditLog: {},
      expenses: {}
    }
  }
];
```
(Note: this last block is followed by `];`, closing `SEED_ROLES` — keep that.)

- [ ] **Step 3: Call COA generation at provisioning**

Find (inside `provisionTenantInTx`):
```ts
  await tx.cooperativeUnit.createMany({
    data: units.map((u) => ({ tenantId: tenant.id, type: u.type, name: u.name }))
  });

  const roles = await Promise.all(
```

Replace with:
```ts
  await tx.cooperativeUnit.createMany({
    data: units.map((u) => ({ tenantId: tenant.id, type: u.type, name: u.name }))
  });

  // Every tenant gets the standard COA regardless of package — Beban Umum
  // (general expense entry) is a base feature, not gated by the "accounting"
  // add-on, and needs real BEBAN/Kas accounts to post against from day one.
  // See docs/2026-09-27-beban-umum-design.md.
  await generateStandardCoaInTx(tx, tenant.id);

  const roles = await Promise.all(
```

- [ ] **Step 4: Add the `expenses` row to the Roles UI**

In `apps/frontend/src/pages/config/RolesTab.tsx`, find:
```ts
const MODULES: { key: PermissionModule; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members", label: "Anggota" },
  { key: "savings", label: "Simpanan" },
  { key: "loans", label: "Pinjaman" },
  { key: "reports", label: "Laporan" },
  { key: "config", label: "Konfigurasi" },
  { key: "users", label: "Pengguna" },
  { key: "roles", label: "Role" },
  { key: "accounting", label: "Akuntansi" },
  { key: "konsumen", label: "Toko" },
  { key: "auditLog", label: "Jejak Audit" }
```

Replace with:
```ts
const MODULES: { key: PermissionModule; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members", label: "Anggota" },
  { key: "savings", label: "Simpanan" },
  { key: "loans", label: "Pinjaman" },
  { key: "reports", label: "Laporan" },
  { key: "config", label: "Konfigurasi" },
  { key: "users", label: "Pengguna" },
  { key: "roles", label: "Role" },
  { key: "accounting", label: "Akuntansi" },
  { key: "konsumen", label: "Toko" },
  { key: "auditLog", label: "Jejak Audit" },
  { key: "expenses", label: "Beban Umum" }
```
(the line after this, `];`, stays as-is)

- [ ] **Step 5: Typecheck backend and frontend**

Run: `pnpm --filter @siskop/backend typecheck && pnpm --filter @siskop/frontend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/tenants/provision.ts apps/frontend/src/pages/config/RolesTab.tsx
git commit -m "feat(provisioning): auto-generate standard COA for every new tenant, add expenses permission"
```

---

### Task 5: Fix existing tests broken by auto-provisioned COA

**Why:** see the note at the top of this document. Run the full backend suite once after this task to confirm everything is green before moving on — do not skip straight to Task 6/7 with a red suite.

**Files (all under `apps/backend/tests/`):**
- `config.test.ts` (the big one)
- `konsumen-credit.test.ts`
- `ksu-consolidation.test.ts`
- `ksu-member-statement.test.ts`
- `konsumen-sale.test.ts`
- `reports.test.ts`
- `toko-accounting.test.ts`

- [ ] **Step 1: `config.test.ts` — rewrite the "fresh tenant" COA test**

Find:
```ts
describe("POST /api/config/accounts/generate-standard", () => {
  it("creates the full standard COA template for a fresh tenant with no configs", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.accountsCreated).toBeGreaterThan(0);
    expect(res.body.data.accountsSkipped).toBe(0);
    expect(res.body.data.mappingsCreated).toBe(0);

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(accounts.body.data.length).toBe(res.body.data.accountsCreated);
    expect(accounts.body.data.some((a: { code: string }) => a.code === "1-1000")).toBe(true);
  });

  it("is idempotent — calling it again creates nothing new", async () => {
    const admin = await setupTenant();
    const first = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const second = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(second.status).toBe(200);
    expect(second.body.data.accountsCreated).toBe(0);
    expect(second.body.data.accountsSkipped).toBe(first.body.data.accountsCreated);
    expect(second.body.data.mappingsCreated).toBe(0);
  });
```

Replace with:
```ts
describe("POST /api/config/accounts/generate-standard", () => {
  it("a fresh tenant already has the standard COA from provisioning, and the button is then a no-op", async () => {
    const admin = await setupTenant();

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(accounts.body.data.length).toBeGreaterThan(0);
    expect(accounts.body.data.some((a: { code: string }) => a.code === "1-1000")).toBe(true);
    const provisionedCount = accounts.body.data.length;

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.accountsCreated).toBe(0);
    expect(res.body.data.accountsSkipped).toBe(provisionedCount);
    expect(res.body.data.mappingsCreated).toBe(0);
  });

  it("is idempotent — calling it again creates nothing new", async () => {
    const admin = await setupTenant();
    const first = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const second = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.accountsCreated).toBe(0);
    expect(second.body.data.accountsCreated).toBe(0);
    expect(second.body.data.accountsSkipped).toBe(first.body.data.accountsSkipped);
    expect(second.body.data.mappingsCreated).toBe(0);
  });
```

- [ ] **Step 2: `config.test.ts` — fix the "skips a customized account" test**

Find:
```ts
  it("skips an account that was already created manually, without conflicting", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, { code: "1-1000", name: "Kas Lama" });

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.accountsSkipped).toBe(1);

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const kasAccounts = accounts.body.data.filter((a: { code: string }) => a.code === "1-1000");
    expect(kasAccounts).toHaveLength(1);
    expect(kasAccounts[0].name).toBe("Kas Lama");
  });
```

Replace with:
```ts
  it("skips an account that was already customized, without conflicting", async () => {
    const admin = await setupTenant();
    const before = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const kas = before.body.data.find((a: { code: string }) => a.code === "1-1000");

    await request(app())
      .put(`/api/config/accounts/${kas.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Kas Lama" });

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.accountsCreated).toBe(0);

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const kasAccounts = accounts.body.data.filter((a: { code: string }) => a.code === "1-1000");
    expect(kasAccounts).toHaveLength(1);
    expect(kasAccounts[0].name).toBe("Kas Lama");
  });
```

- [ ] **Step 3: `config.test.ts` — fix the cross-tenant isolation test**

Find:
```ts
  it("does not touch another tenant's accounts", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    const accountsB = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${tenantB.accessToken}`);
    expect(accountsB.body.data).toHaveLength(0);
  });
```

Replace with:
```ts
  it("does not touch another tenant's accounts", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    const before = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${tenantB.accessToken}`);

    await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    const after = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${tenantB.accessToken}`);
    expect(after.body.data).toHaveLength(before.body.data.length);
    expect(after.body.data.map((a: { code: string }) => a.code).sort()).toEqual(
      before.body.data.map((a: { code: string }) => a.code).sort()
    );
  });
```

- [ ] **Step 4: `config.test.ts` — rename colliding codes in the Toko hand-mapped test**

Find (three `code:` lines inside `"does not create duplicate Toko accounts when the SYSTEM sale mappings were already set up by hand"`):
```ts
    const kas = await createAccountAs(admin.accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
    const penjualan = await createAccountAs(admin.accessToken, {
      code: "4-2000",
      name: "Penjualan Toko",
      category: "PENDAPATAN",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
    const hpp = await createAccountAs(admin.accessToken, {
      code: "5-1000",
      name: "HPP",
      category: "BEBAN",
      normalBalance: "DEBIT",
      isCashEquivalent: false
    });
    const persediaan = await createAccountAs(admin.accessToken, {
      code: "1-1300",
```

Replace with (only the three codes change — `1-1300` on the last line is untouched, it's already collision-free):
```ts
    const kas = await createAccountAs(admin.accessToken, { code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
    const penjualan = await createAccountAs(admin.accessToken, {
      code: "9-4200",
      name: "Penjualan Toko",
      category: "PENDAPATAN",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
    const hpp = await createAccountAs(admin.accessToken, {
      code: "9-5000",
      name: "HPP",
      category: "BEBAN",
      normalBalance: "DEBIT",
      isCashEquivalent: false
    });
    const persediaan = await createAccountAs(admin.accessToken, {
      code: "1-1300",
```

- [ ] **Step 5: `config.test.ts` — rewrite the 3 equity-classification tests that pre-create colliding codes**

Find:
```ts
  it("classifies an existing unclassified template equity account on re-generate", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Simpanan Pokok",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });

    await generateStandard(admin.accessToken);

    const pokok = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(pokok?.equityClass).toBe("SIMPANAN_POKOK");
  });

  it("leaves a template-coded account with a different name unclassified — the code alone can't say what it holds", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Modal Kerja",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(account).toMatchObject({ name: "Modal Kerja", equityClass: null });
  });
```

Replace with (uses `db.account.updateMany` on the already-provisioned row instead of trying to create a duplicate — same intent, adapted to the new reality that `3-1000` already exists):
```ts
  it("classifies an existing unclassified template equity account on re-generate", async () => {
    const admin = await setupTenant();
    // Provisioning already created 3-1000 with its equityClass set — null it
    // out to recreate the pre-equityClass-column state this test exercises.
    await db.account.updateMany({
      where: { tenantId: admin.user.tenantId, code: "3-1000" },
      data: { equityClass: null }
    });

    await generateStandard(admin.accessToken);

    const pokok = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(pokok?.equityClass).toBe("SIMPANAN_POKOK");
  });

  it("leaves a template-coded account with a different name unclassified — the code alone can't say what it holds", async () => {
    const admin = await setupTenant();
    // Simulate a tenant that put something else entirely at the template's
    // 3-1000 code — the classify-on-regenerate logic must match on name too.
    await db.account.updateMany({
      where: { tenantId: admin.user.tenantId, code: "3-1000" },
      data: { name: "Modal Kerja", equityClass: null }
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(account).toMatchObject({ name: "Modal Kerja", equityClass: null });
  });
```

Now find:
```ts
  it("does not overwrite an equity class the tenant already chose", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan / Modal Penyertaan",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      equityClass: "MODAL_PENYERTAAN"
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-2000");
    expect(account?.equityClass).toBe("MODAL_PENYERTAAN");
  });
```

Replace with:
```ts
  it("does not overwrite an equity class the tenant already chose", async () => {
    const admin = await setupTenant();
    // Provisioning created 3-2000 as "Cadangan Umum" / CADANGAN_UMUM — simulate
    // the tenant having reclassified it before re-running the button.
    await db.account.updateMany({
      where: { tenantId: admin.user.tenantId, code: "3-2000" },
      data: { name: "Cadangan / Modal Penyertaan", equityClass: "MODAL_PENYERTAAN" }
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-2000");
    expect(account?.equityClass).toBe("MODAL_PENYERTAAN");
  });
```

- [ ] **Step 6: `config.test.ts` — rename two more colliding fixture codes**

Find:
```ts
  it("updates an account's equity class and can clear it", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });
```

Replace with:
```ts
  it("updates an account's equity class and can clear it", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "9-3200",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });
```

Find:
```ts
  it("clears the equity class when an account moves out of EKUITAS", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      equityClass: "CADANGAN_UMUM"
    });
```

Replace with:
```ts
  it("clears the equity class when an account moves out of EKUITAS", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "9-3200",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      equityClass: "CADANGAN_UMUM"
    });
```

- [ ] **Step 7: Run `config.test.ts` alone**

Run: `pnpm --filter @siskop/backend exec vitest run tests/config.test.ts`
Expected: all tests pass.

- [ ] **Step 8: `konsumen-credit.test.ts` — rename colliding code**

Find:
```ts
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
```

Replace with:
```ts
  const kas = await createAccount(accessToken, { code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
```

- [ ] **Step 9: `ksu-consolidation.test.ts` — rename 5 colliding codes**

Find:
```ts
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "4-1000",
    name: "Penjualan",
    category: "PENDAPATAN",
    normalBalance: "KREDIT"
  });
  const hpp = await createAccount(accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```

Replace with:
```ts
  const kas = await createAccount(accessToken, { code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "9-4000",
    name: "Penjualan",
    category: "PENDAPATAN",
    normalBalance: "KREDIT"
  });
  const hpp = await createAccount(accessToken, { code: "9-5000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```

Find:
```ts
  const piutang = await createAccount(accessToken, {
    code: "1-1100",
    name: "Piutang Pinjaman Anggota",
    category: "ASET",
    normalBalance: "DEBIT"
  });
  const modal = await createAccount(accessToken, {
    code: "3-1000",
    name: "Modal Kerja",
    category: "EKUITAS",
    normalBalance: "KREDIT"
  });
```

Replace with:
```ts
  const piutang = await createAccount(accessToken, {
    code: "9-1100",
    name: "Piutang Pinjaman Anggota",
    category: "ASET",
    normalBalance: "DEBIT"
  });
  const modal = await createAccount(accessToken, {
    code: "9-3000",
    name: "Modal Kerja",
    category: "EKUITAS",
    normalBalance: "KREDIT"
  });
```

- [ ] **Step 10: `ksu-member-statement.test.ts` — rename 2 colliding codes**

Find:
```ts
  const kas = await db.account.create({
    data: { tenantId, code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" }
  });
  const pendapatan = await db.account.create({
    data: { tenantId, code: "4-1000", name: "Pendapatan Bunga", category: "PENDAPATAN", normalBalance: "KREDIT" }
  });
```

Replace with:
```ts
  const kas = await db.account.create({
    data: { tenantId, code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" }
  });
  const pendapatan = await db.account.create({
    data: { tenantId, code: "9-4000", name: "Pendapatan Bunga", category: "PENDAPATAN", normalBalance: "KREDIT" }
  });
```

- [ ] **Step 11: `konsumen-sale.test.ts` — rename colliding codes in both helpers**

Find:
```ts
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "4-1000",
```

Replace with:
```ts
  const kas = await createAccount(accessToken, { code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "9-4000",
```
(this is the `setupSaleMappings`-style helper near the top of the file — there is exactly one `"1-1000"` in this file, so this is unambiguous)

Find (the two remaining `"4-1000"` / `"5-1000"` occurrences — use `replace_all` since both instances in this file need the identical fix):
```ts
    code: "4-1000",
```
Replace all occurrences with:
```ts
    code: "9-4000",
```

Find (both `"5-1000"` occurrences, `replace_all`):
```ts
  const hpp = await createAccount(accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```
Replace all occurrences with:
```ts
  const hpp = await createAccount(accessToken, { code: "9-5000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```

- [ ] **Step 12: `reports.test.ts` — rename 3 constants + 1 inline code**

Find:
```ts
const KAS = { code: "1-1000", name: "Kas", category: "ASET" as const, normalBalance: "DEBIT" as const, isCashEquivalent: true };
const SIMPANAN_SUKARELA_ACC = {
  code: "2-1000",
  name: "Simpanan Sukarela",
  category: "KEWAJIBAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};
const PENDAPATAN_BUNGA = {
  code: "4-1000",
  name: "Pendapatan Bunga",
  category: "PENDAPATAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};
```

Replace with:
```ts
const KAS = { code: "9-1000", name: "Kas", category: "ASET" as const, normalBalance: "DEBIT" as const, isCashEquivalent: true };
const SIMPANAN_SUKARELA_ACC = {
  code: "9-2000",
  name: "Simpanan Sukarela",
  category: "KEWAJIBAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};
const PENDAPATAN_BUNGA = {
  code: "9-4000",
  name: "Pendapatan Bunga",
  category: "PENDAPATAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};
```

Find:
```ts
    const pokokAcc = await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Simpanan Pokok",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
```

Replace with:
```ts
    const pokokAcc = await createAccountAs(admin.accessToken, {
      code: "9-3000",
      name: "Simpanan Pokok",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
```

- [ ] **Step 13: `toko-accounting.test.ts` — rename 3 colliding codes (leave lines 349-350 alone — they fetch, not create)**

Find:
```ts
    const kas = await createAccount(admin.accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
    const penjualan = await createAccount(admin.accessToken, {
      code: "4-1000",
      name: "Penjualan",
      category: "PENDAPATAN",
      normalBalance: "KREDIT"
    });
    await createSystemMapping(admin.accessToken, "SALE_REVENUE", kas.id, penjualan.id);

    const sale = await sell(admin, unit.id, product.id, 3);

    const lopsided = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(lopsided.status).toBe("UNPOSTED_MISSING_MAPPING");
    expect(lopsided.lines).toEqual([]);

    const hpp = await createAccount(admin.accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```

Replace with:
```ts
    const kas = await createAccount(admin.accessToken, { code: "9-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
    const penjualan = await createAccount(admin.accessToken, {
      code: "9-4000",
      name: "Penjualan",
      category: "PENDAPATAN",
      normalBalance: "KREDIT"
    });
    await createSystemMapping(admin.accessToken, "SALE_REVENUE", kas.id, penjualan.id);

    const sale = await sell(admin, unit.id, product.id, 3);

    const lopsided = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(lopsided.status).toBe("UNPOSTED_MISSING_MAPPING");
    expect(lopsided.lines).toEqual([]);

    const hpp = await createAccount(admin.accessToken, { code: "9-5000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
```

- [ ] **Step 14: Run the full backend suite**

Run: `pnpm --filter @siskop/backend test`
Expected: all suites pass, coverage gate holds. If anything else is red, it's a fixture collision this task missed — grep that file for `code: "` and cross-reference against `COA_TEMPLATE` in `apps/backend/src/lib/coaTemplate.ts` the same way this task did.

- [ ] **Step 15: Commit**

```bash
git add apps/backend/tests/config.test.ts apps/backend/tests/konsumen-credit.test.ts apps/backend/tests/ksu-consolidation.test.ts apps/backend/tests/ksu-member-statement.test.ts apps/backend/tests/konsumen-sale.test.ts apps/backend/tests/reports.test.ts apps/backend/tests/toko-accounting.test.ts
git commit -m "test: adapt fixtures to auto-provisioned COA (rename colliding codes, fix idempotency assertions)"
```

---

### Task 6: `lib/journal.ts` — `postManualExpense`

**Files:**
- Modify: `apps/backend/src/lib/journal.ts`

- [ ] **Step 1: Widen `createJournalEntry`'s params and make it return the entry id**

Find:
```ts
async function createJournalEntry(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The unit the source transaction belongs to; null for an entry that belongs to no single unit. */
    unitId: string | null;
    entryDate: Date;
    sourceType:
      | "SAVING_TRANSACTION"
      | "LOAN_PAYMENT"
      | "LOAN_DISBURSEMENT"
      | "POS_SALE"
      | "MEMBER_CREDIT_REPAYMENT"
      | "STOCK_MOVEMENT";
    sourceId: string;
    description: string;
    lines: JournalLineInput[];
  }
): Promise<void> {
  const { tenantId, unitId, entryDate, sourceType, sourceId, description, lines } = params;

  assertBalanced(lines, `${sourceType}:${sourceId}`);

  const entry = await tx.journalEntry.create({
    data: {
      tenantId,
      unitId,
      entryDate,
      sourceType,
      sourceId,
      description,
      status: lines.length > 0 ? "POSTED" : "UNPOSTED_MISSING_MAPPING"
    }
  });

  if (lines.length > 0) {
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        journalEntryId: entry.id,
        tenantId,
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0
      }))
    });
  }
}
```

Replace with:
```ts
async function createJournalEntry(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The unit the source transaction belongs to; null for an entry that belongs to no single unit. */
    unitId: string | null;
    entryDate: Date;
    sourceType:
      | "SAVING_TRANSACTION"
      | "LOAN_PAYMENT"
      | "LOAN_DISBURSEMENT"
      | "POS_SALE"
      | "MEMBER_CREDIT_REPAYMENT"
      | "STOCK_MOVEMENT"
      | "MANUAL_EXPENSE";
    /** Null for MANUAL_EXPENSE — that entry has no separate source row, it IS the record. */
    sourceId: string | null;
    description: string;
    lines: JournalLineInput[];
  }
): Promise<{ id: string }> {
  const { tenantId, unitId, entryDate, sourceType, sourceId, description, lines } = params;

  assertBalanced(lines, `${sourceType}:${sourceId}`);

  const entry = await tx.journalEntry.create({
    data: {
      tenantId,
      unitId,
      entryDate,
      sourceType,
      sourceId,
      description,
      status: lines.length > 0 ? "POSTED" : "UNPOSTED_MISSING_MAPPING"
    }
  });

  if (lines.length > 0) {
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        journalEntryId: entry.id,
        tenantId,
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0
      }))
    });
  }

  return { id: entry.id };
}
```

- [ ] **Step 2: Add `postManualExpense` after `postStockPurchase`**

Find:
```ts
export async function postStockPurchase(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The StockMovement's unitId (the Toko that was restocked). */
    unitId: string | null;
    movementId: string;
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  if (new Prisma.Decimal(params.amount).lte(0)) return;

  const mappings = await loadSystemMappings(tx, params.tenantId);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "STOCK_MOVEMENT",
    sourceId: params.movementId,
    description: params.description,
    lines: stockPurchaseLinesFrom(mappings, params.amount)
  });
}
```

Replace with (adds the new function after it, original function unchanged):
```ts
export async function postStockPurchase(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The StockMovement's unitId (the Toko that was restocked). */
    unitId: string | null;
    movementId: string;
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  if (new Prisma.Decimal(params.amount).lte(0)) return;

  const mappings = await loadSystemMappings(tx, params.tenantId);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "STOCK_MOVEMENT",
    sourceId: params.movementId,
    description: params.description,
    lines: stockPurchaseLinesFrom(mappings, params.amount)
  });
}

/**
 * Books a Beban Umum entry (salary, rent, general admin expenses) as a
 * balanced 2-line journal entry: debit a BEBAN account, credit a
 * cash-equivalent account. Account category/isCashEquivalent and tenant
 * ownership are validated in modules/expenses/service.ts before this is
 * called — this only builds and persists the balanced pair. Always exactly
 * 2 lines, so unlike every other postX helper here this never lands as
 * UNPOSTED_MISSING_MAPPING.
 */
export async function postManualExpense(
  tx: TxClient,
  params: {
    tenantId: string;
    unitId: string | null;
    debitAccountId: string;
    creditAccountId: string;
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<{ id: string }> {
  return createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "MANUAL_EXPENSE",
    sourceId: null,
    description: params.description,
    lines: [
      { accountId: params.debitAccountId, debit: params.amount },
      { accountId: params.creditAccountId, credit: params.amount }
    ]
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @siskop/backend typecheck`
Expected: no errors. (If you see a complaint about `sourceId: string` vs `string | null` at another call site, every existing caller already passes a real id, which satisfies the widened type — double check you edited the type, not a call site.)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/lib/journal.ts
git commit -m "feat(journal): add postManualExpense for Beban Umum"
```

---

### Task 7: Backend `expenses` module (TDD — test file first)

**Files:**
- Create: `apps/backend/tests/expenses.test.ts`
- Create: `apps/backend/src/modules/expenses/schema.ts`
- Create: `apps/backend/src/modules/expenses/service.ts`
- Create: `apps/backend/src/modules/expenses/routes.ts`
- Modify: `apps/backend/src/app.ts`

- [ ] **Step 1: Write the test file**

Create `apps/backend/tests/expenses.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

interface ExpenseAccounts {
  debitAccounts: Array<{ id: string; code: string; name: string }>;
  creditAccounts: Array<{ id: string; code: string; name: string }>;
}

async function getExpenseAccounts(accessToken: string): Promise<ExpenseAccounts> {
  const res = await request(app()).get("/api/expenses/accounts").set(bearer(accessToken));
  expect(res.status).toBe(200);
  return res.body.data as ExpenseAccounts;
}

async function createExpense(accessToken: string, overrides: Record<string, unknown> = {}) {
  const { debitAccounts, creditAccounts } = await getExpenseAccounts(accessToken);
  const gaji = debitAccounts.find((a) => a.code === "5-2000")!;
  const kas = creditAccounts.find((a) => a.code === "1-1000")!;
  return request(app())
    .post("/api/expenses")
    .set(bearer(accessToken))
    .send({
      entryDate: "2026-09-27",
      description: "Gaji staf September",
      amount: 500_000,
      debitAccountId: gaji.id,
      creditAccountId: kas.id,
      ...overrides
    });
}

describe("GET /api/expenses/accounts", () => {
  it("returns BEBAN and cash-equivalent accounts for a freshly provisioned tenant, no accounting entitlement needed", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const { debitAccounts, creditAccounts } = await getExpenseAccounts(admin.accessToken);

    expect(debitAccounts.some((a) => a.code === "5-2000")).toBe(true); // Beban Operasional — Gaji
    expect(debitAccounts.every((a) => a.code.startsWith("5-"))).toBe(true);
    expect(creditAccounts.some((a) => a.code === "1-1000")).toBe(true); // Kas
    expect(creditAccounts.some((a) => a.code === "1-1010")).toBe(true); // Bank
  });
});

describe("POST /api/expenses", () => {
  it("books a balanced MANUAL_EXPENSE journal entry", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await createExpense(admin.accessToken);

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe("500000");
    expect(res.body.data.debitAccountName).toBe("Beban Operasional — Gaji");
    expect(res.body.data.creditAccountName).toBe("Kas");
    expect(res.body.data.unitId).toBeNull();

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "MANUAL_EXPENSE" },
      include: { lines: true }
    });
    expect(entry.status).toBe("POSTED");
    expect(entry.lines).toHaveLength(2);
  });

  it("rejects a debit account that isn't a BEBAN category", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const { creditAccounts } = await getExpenseAccounts(admin.accessToken);
    const kas = creditAccounts.find((a) => a.code === "1-1000")!;

    const res = await createExpense(admin.accessToken, { debitAccountId: kas.id });

    expect(res.status).toBe(422);
  });

  it("rejects a credit account that isn't cash-equivalent", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const { debitAccounts } = await getExpenseAccounts(admin.accessToken);
    const gaji = debitAccounts.find((a) => a.code === "5-2000")!;

    const res = await createExpense(admin.accessToken, { creditAccountId: gaji.id });

    expect(res.status).toBe(422);
  });

  it("rejects an account id belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" }, { entitled: false });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" }, { entitled: false });
    const { debitAccounts } = await getExpenseAccounts(tenantB.accessToken);
    const gajiB = debitAccounts.find((a) => a.code === "5-2000")!;

    const res = await createExpense(tenantA.accessToken, { debitAccountId: gajiB.id });

    expect(res.status).toBe(404);
  });

  it("accepts an optional unitId and rejects one from another tenant", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER" }, { entitled: false });
    const otherUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: other.user.tenantId } });

    const ok = await createExpense(admin.accessToken, { unitId: unit.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.unitId).toBe(unit.id);

    const cross = await createExpense(admin.accessToken, { unitId: otherUnit.id });
    expect(cross.status).toBe(404);
  });

  it("403s a Kasir, who has no expenses permission", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    const res = await createExpense(kasir.accessToken);

    expect(res.status).toBe(403);
  });
});

describe("GET /api/expenses", () => {
  it("lists an expense and filters by unitId", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await createExpense(admin.accessToken, { description: "Tenant-level expense" });
    await createExpense(admin.accessToken, { description: "Unit expense", unitId: unit.id });

    const all = await request(app()).get("/api/expenses").set(bearer(admin.accessToken));
    expect(all.body.data).toHaveLength(2);

    const scoped = await request(app()).get(`/api/expenses?unitId=${unit.id}`).set(bearer(admin.accessToken));
    expect(scoped.body.data).toHaveLength(1);
    expect(scoped.body.data[0].description).toBe("Unit expense");
  });
});

describe("DELETE /api/expenses/:id", () => {
  it("deletes an expense and its journal lines", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const created = await createExpense(admin.accessToken);

    const res = await request(app()).delete(`/api/expenses/${created.body.data.id}`).set(bearer(admin.accessToken));
    expect(res.status).toBe(200);

    const entry = await db.journalEntry.findFirst({ where: { id: created.body.data.id } });
    expect(entry).toBeNull();
    const lines = await db.journalLine.findMany({ where: { journalEntryId: created.body.data.id } });
    expect(lines).toHaveLength(0);
  });

  it("404s deleting an id that isn't a MANUAL_EXPENSE entry", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const other = await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "not an expense",
        status: "POSTED"
      }
    });

    const res = await request(app()).delete(`/api/expenses/${other.id}`).set(bearer(admin.accessToken));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/expenses.test.ts`
Expected: FAIL — every request 404s (`/api/expenses*` doesn't exist yet).

- [ ] **Step 3: Write `schema.ts`**

Create `apps/backend/src/modules/expenses/schema.ts`:
```ts
import { z } from "zod";

export const createExpenseSchema = z.object({
  entryDate: z.coerce.date(),
  description: z.string().min(1, "Keterangan wajib diisi"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  debitAccountId: z.string().min(1, "Pilih akun beban"),
  creditAccountId: z.string().min(1, "Pilih akun kas/bank"),
  unitId: z.string().optional()
});

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unitId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ListExpensesQueryInput = z.infer<typeof listExpensesQuerySchema>;
```

- [ ] **Step 4: Write `service.ts`**

Create `apps/backend/src/modules/expenses/service.ts`:
```ts
import { Prisma } from "@prisma/client";
import { endOfDay } from "date-fns";
import { db } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import { postManualExpense } from "../../lib/journal.js";
import type { CreateExpenseInput, ListExpensesQueryInput } from "./schema.js";

const EXPENSE_INCLUDE = { lines: { include: { account: true } }, unit: true } as const;

type ExpenseEntryRow = Prisma.JournalEntryGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

function toExpenseEntry(entry: ExpenseEntryRow) {
  const debitLine = entry.lines.find((l) => new Prisma.Decimal(l.debit).gt(0));
  const creditLine = entry.lines.find((l) => new Prisma.Decimal(l.credit).gt(0));
  if (!debitLine || !creditLine) {
    throw new Error(`Beban Umum entry ${entry.id} is missing its debit/credit line`);
  }
  return {
    id: entry.id,
    entryDate: entry.entryDate,
    description: entry.description,
    amount: debitLine.debit,
    debitAccountId: debitLine.accountId,
    debitAccountName: debitLine.account.name,
    creditAccountId: creditLine.accountId,
    creditAccountName: creditLine.account.name,
    unitId: entry.unitId,
    unitName: entry.unit?.name ?? null,
    createdAt: entry.createdAt
  };
}

export async function listExpenseAccounts(tenantId: string) {
  const [debitAccounts, creditAccounts] = await Promise.all([
    db.account.findMany({ where: { tenantId, category: "BEBAN", isActive: true }, orderBy: { code: "asc" } }),
    db.account.findMany({ where: { tenantId, isCashEquivalent: true, isActive: true }, orderBy: { code: "asc" } })
  ]);
  return { debitAccounts, creditAccounts };
}

async function resolveOptionalUnitId(tenantId: string, unitId?: string): Promise<string | null> {
  if (!unitId) return null;
  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId, isActive: true } });
  if (!unit) throw notFound("Unit tidak ditemukan");
  return unit.id;
}

async function getExpenseById(tenantId: string, id: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { id, tenantId, sourceType: "MANUAL_EXPENSE" },
    include: EXPENSE_INCLUDE
  });
  return toExpenseEntry(entry);
}

export async function createExpense(tenantId: string, input: CreateExpenseInput) {
  const [debitAccount, creditAccount, unitId] = await Promise.all([
    db.account.findFirst({ where: { id: input.debitAccountId, tenantId } }),
    db.account.findFirst({ where: { id: input.creditAccountId, tenantId } }),
    resolveOptionalUnitId(tenantId, input.unitId)
  ]);

  if (!debitAccount) throw notFound("Akun beban tidak ditemukan");
  if (debitAccount.category !== "BEBAN" || !debitAccount.isActive) {
    throw validationError("Akun debit harus akun Beban yang aktif");
  }
  if (!creditAccount) throw notFound("Akun kas/bank tidak ditemukan");
  if (!creditAccount.isCashEquivalent || !creditAccount.isActive) {
    throw validationError("Akun kredit harus akun kas/bank yang aktif");
  }

  const entry = await db.$transaction((tx) =>
    postManualExpense(tx, {
      tenantId,
      unitId,
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      amount: input.amount,
      entryDate: input.entryDate,
      description: input.description
    })
  );

  return getExpenseById(tenantId, entry.id);
}

export async function listExpenses(tenantId: string, query: ListExpensesQueryInput) {
  const { page, limit, unitId, from, to } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.JournalEntryWhereInput = {
    tenantId,
    sourceType: "MANUAL_EXPENSE",
    ...(unitId ? { unitId } : {}),
    ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } } : {})
  };

  const [items, total] = await Promise.all([
    db.journalEntry.findMany({ where, skip, take: limit, include: EXPENSE_INCLUDE, orderBy: { entryDate: "desc" } }),
    db.journalEntry.count({ where })
  ]);

  return { items: items.map(toExpenseEntry), meta: { page, limit, total } };
}

export async function deleteExpense(tenantId: string, id: string): Promise<void> {
  const entry = await db.journalEntry.findFirst({ where: { id, tenantId, sourceType: "MANUAL_EXPENSE" } });
  if (!entry) throw notFound("Beban tidak ditemukan");
  await db.journalEntry.delete({ where: { id: entry.id } });
}
```

- [ ] **Step 5: Write `routes.ts`**

Create `apps/backend/src/modules/expenses/routes.ts`:
```ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createExpenseSchema, listExpensesQuerySchema } from "./schema.js";
import { createExpense, deleteExpense, listExpenseAccounts, listExpenses } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function expensesRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // Registered before the bare "/" list so it reads clearly as its own
  // endpoint — not required for route matching (different HTTP verbs never
  // shadow each other), just consistent with product.routes.ts's ordering
  // discipline.
  router.get(
    "/accounts",
    requirePermission("expenses", "read"),
    handle(async (req, res) => {
      const data = await listExpenseAccounts(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/",
    requirePermission("expenses", "read"),
    handle(async (req, res) => {
      const query = listExpensesQuerySchema.parse(req.query);
      const result = await listExpenses(authClaims(req).tenantId, query);
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, ...result.meta } });
    })
  );

  router.post(
    "/",
    requirePermission("expenses", "create"),
    handle(async (req, res) => {
      const data = createExpenseSchema.parse(req.body);
      const expense = await createExpense(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: expense, meta: res.locals.meta });
    })
  );

  router.delete(
    "/:id",
    requirePermission("expenses", "delete"),
    handle(async (req, res) => {
      await deleteExpense(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: { deleted: true }, meta: res.locals.meta });
    })
  );

  return router;
}
```

- [ ] **Step 6: Mount the router**

In `apps/backend/src/app.ts`, find:
```ts
import { auditLogRoutes } from "./modules/audit-log/routes.js";
```

Replace with:
```ts
import { auditLogRoutes } from "./modules/audit-log/routes.js";
import { expensesRoutes } from "./modules/expenses/routes.js";
```

Find:
```ts
  app.use("/api/audit-log", auditLogRoutes());
```

Replace with:
```ts
  app.use("/api/audit-log", auditLogRoutes());
  app.use("/api/expenses", expensesRoutes());
```

- [ ] **Step 7: Run the test file again and confirm it passes**

Run: `pnpm --filter @siskop/backend exec vitest run tests/expenses.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @siskop/backend typecheck && pnpm --filter @siskop/backend lint`
Expected: no errors.

- [ ] **Step 9: Run the full backend suite once more**

Run: `pnpm --filter @siskop/backend test`
Expected: all suites pass, coverage gate (80% lines) holds.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/tests/expenses.test.ts apps/backend/src/modules/expenses apps/backend/src/app.ts
git commit -m "feat(expenses): add Beban Umum backend module (list/create/delete, ungated)"
```

---

### Task 8: Frontend — Beban Umum page

**Files:**
- Create: `apps/frontend/src/pages/expenses/ExpensesPage.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/layout/Sidebar.tsx`

No automated tests exist for frontend pages in this codebase (only `apps/frontend/src/lib/aiSuggestions.test.ts`, pure logic) — verification is manual, in Task 9.

- [ ] **Step 1: Write the page**

Create `apps/frontend/src/pages/expenses/ExpensesPage.tsx`:
```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Account, CooperativeUnit, ExpenseAccountsResponse, ExpenseEntry } from "@siskop/types";
import { apiFetch, apiFetchPage, apiDelete, apiPost, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { formatRupiah } from "@/lib/format";

const LIMIT = 20;
const NO_UNIT = "__none__";

const schema = z.object({
  entryDate: z.string().min(1, "Tanggal wajib diisi"),
  description: z.string().min(1, "Keterangan wajib diisi"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  debitAccountId: z.string().min(1, "Pilih akun beban"),
  creditAccountId: z.string().min(1, "Pilih akun kas/bank"),
  unitId: z.string().optional()
});
type FormValues = z.infer<typeof schema>;

export function ExpensesPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["expenses", { page }],
    queryFn: () => apiFetchPage<ExpenseEntry[]>(`/expenses?page=${page}&limit=${LIMIT}`)
  });
  const { data: accounts } = useQuery({
    queryKey: ["expenses", "accounts"],
    queryFn: () => apiFetch<ExpenseAccountsResponse>("/expenses/accounts")
  });
  const { data: units } = useQuery({
    queryKey: ["config", "units", "mine"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units/mine")
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { entryDate: "", description: "", amount: 0, debitAccountId: "", creditAccountId: "", unitId: "" }
  });
  const values = watch();

  const openCreate = () => {
    setApiError("");
    reset({ entryDate: new Date().toISOString().slice(0, 10), description: "", amount: 0, debitAccountId: "", creditAccountId: "", unitId: "" });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      await apiPost("/expenses", { ...values, unitId: values.unitId || undefined });
      toast({ title: "Beban tercatat" });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiDelete(`/expenses/${deleteTarget.id}`);
      toast({ title: "Beban dihapus" });
      setDeleteTarget(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menghapus beban",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<ExpenseEntry>[] = [
    { header: "Tanggal", cell: ({ row }) => new Date(row.original.entryDate).toLocaleDateString("id-ID") },
    { header: "Keterangan", accessorKey: "description" },
    { header: "Akun Beban", accessorKey: "debitAccountName" },
    { header: "Akun Kredit", accessorKey: "creditAccountName" },
    { header: "Unit", cell: ({ row }) => row.original.unitName ?? "Semua Unit" },
    { header: "Jumlah", cell: ({ row }) => formatRupiah(row.original.amount) },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("expenses", "delete") && (
          <Button size="sm" variant="outline" onClick={() => setDeleteTarget(row.original)}>
            Hapus
          </Button>
        )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Beban Umum" description="Catat pengeluaran administrasi koperasi — gaji, sewa, dan beban umum lainnya" />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyMessage="Belum ada beban tercatat"
        headerActions={
          can("expenses", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Catat Beban
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catat Beban</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Tanggal *</Label>
              <Input type="date" {...register("entryDate")} />
              {errors.entryDate && <p className="text-xs text-destructive">{errors.entryDate.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Keterangan *</Label>
              <Input placeholder="Contoh: Gaji staf September 2026" {...register("description")} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Jumlah (Rp) *</Label>
              <Input type="number" step="1" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Akun Beban *</Label>
                <Select value={values.debitAccountId} onValueChange={(v) => setValue("debitAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts?.debitAccounts ?? []).map((a: Account) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.debitAccountId && <p className="text-xs text-destructive">{errors.debitAccountId.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Dibayar dari *</Label>
                <Select value={values.creditAccountId} onValueChange={(v) => setValue("creditAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts?.creditAccounts ?? []).map((a: Account) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.creditAccountId && <p className="text-xs text-destructive">{errors.creditAccountId.message}</p>}
              </div>
            </div>

            {(units ?? []).length > 1 && (
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select
                  value={values.unitId || NO_UNIT}
                  onValueChange={(v) => setValue("unitId", v === NO_UNIT ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT}>Semua Unit</SelectItem>
                    {(units ?? []).map((u: CooperativeUnit) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus beban ini?"
        description="Jurnal beban ini akan dihapus. Jika ini kesalahan input, catat ulang dengan data yang benar."
        variant="destructive"
        onConfirm={onDelete}
      />
    </div>
  );
}
```

**Note:** the shadcn `Select` component in this codebase doesn't accept an empty-string `value` (see memory: shadcn Select+RHF gotcha) — that's why the unit picker maps the "no unit" state to the sentinel `NO_UNIT` instead of `""`. If `pnpm --filter @siskop/frontend typecheck` or the manual browser check in Task 9 shows a warning about this, re-check that memory note before changing the approach.

- [ ] **Step 2: Register the route**

In `apps/frontend/src/App.tsx`, find:
```ts
const ConfigPage = lazy(() =>
  import("@/pages/config/ConfigPage").then((module) => ({ default: module.ConfigPage }))
);
```

Replace with:
```ts
const ConfigPage = lazy(() =>
  import("@/pages/config/ConfigPage").then((module) => ({ default: module.ConfigPage }))
);
const ExpensesPage = lazy(() =>
  import("@/pages/expenses/ExpensesPage").then((module) => ({ default: module.ExpensesPage }))
);
```

Find:
```tsx
              <Route path='/config' element={<ConfigPage />} />
              <Route path='/profile' element={<ProfilePage />} />
```

Replace with:
```tsx
              <Route path='/expenses' element={<ExpensesPage />} />

              <Route path='/config' element={<ConfigPage />} />
              <Route path='/profile' element={<ProfilePage />} />
```

- [ ] **Step 3: Add the sidebar nav item**

In `apps/frontend/src/components/layout/Sidebar.tsx`, find:
```tsx
import {
  LayoutDashboard,
  Users,
  PiggyBank,
  CreditCard,
  FileText,
  AlertTriangle,
  Building2,
  Landmark,
  Store,
  Settings,
  X,
  Menu,
  Package as PackageIcon,
  ShieldCheck,
  Layers,
  PieChart,
  Receipt
} from "lucide-react";
```

Replace with:
```tsx
import {
  LayoutDashboard,
  Users,
  PiggyBank,
  CreditCard,
  FileText,
  AlertTriangle,
  Building2,
  Landmark,
  Store,
  Settings,
  X,
  Menu,
  Package as PackageIcon,
  ShieldCheck,
  Layers,
  PieChart,
  Receipt,
  Wallet
} from "lucide-react";
```

Find:
```ts
const NAV_ITEMS_TOP = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" as const, action: "read" as const },
  { label: "Anggota", href: "/members", icon: Users, module: "members" as const, action: "read" as const },
  // Tenant-wide (not unit-scoped, even though the credit originates at the
  // Konsumen/Toko unit's POS) — top-level rather than nested under Unit
  // Usaha > Konsumen, which would misleadingly imply unit-scoping. Reuses the
  // konsumen permission scope, same gate credit.routes.ts already uses.
  { label: "Piutang Anggota", href: "/piutang", icon: Receipt, module: "konsumen" as const, action: "read" as const }
];
```

Replace with:
```ts
const NAV_ITEMS_TOP = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" as const, action: "read" as const },
  { label: "Anggota", href: "/members", icon: Users, module: "members" as const, action: "read" as const },
  // Tenant-wide (not unit-scoped, even though the credit originates at the
  // Konsumen/Toko unit's POS) — top-level rather than nested under Unit
  // Usaha > Konsumen, which would misleadingly imply unit-scoping. Reuses the
  // konsumen permission scope, same gate credit.routes.ts already uses.
  { label: "Piutang Anggota", href: "/piutang", icon: Receipt, module: "konsumen" as const, action: "read" as const },
  // Base feature (not gated by the "accounting" package add-on) — see
  // docs/2026-09-27-beban-umum-design.md. Top-level, not under Konfigurasi:
  // it's a recurring transaction, not a settings screen.
  { label: "Beban Umum", href: "/expenses", icon: Wallet, module: "expenses" as const, action: "read" as const }
];
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/pages/expenses apps/frontend/src/App.tsx apps/frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(expenses): add Beban Umum page, route, and nav item"
```

---

### Task 9: Manual verification

**Files:** none — this is a browser check, per this project's convention of no frontend page tests.

- [ ] **Step 1: Start the stack**

Run `pnpm run dev` (or start backend/frontend separately per `CLAUDE.md`'s command table). Confirm Postgres is on port 5433 and `apps/backend/.env`'s `DATABASE_URL` matches (see memory: dev environment notes) before starting the backend.

- [ ] **Step 2: Register a brand-new tenant** (no package/entitlement) through the normal onboarding flow, or log in as an existing demo tenant's Super Admin.

- [ ] **Step 3: Open "Beban Umum" in the sidebar**

Confirm it's visible for Super Admin, the accounts dropdowns populate (Beban Operasional — Gaji, Beban Sewa, etc. on one side; Kas/Bank on the other) with no "not entitled" error, even though this tenant has no accounting package.

- [ ] **Step 4: Record an expense** (e.g. "Gaji staf", Rp 500.000, Beban Operasional — Gaji, Kas). Confirm it appears in the list with the right amount/date/accounts.

- [ ] **Step 5: Delete it.** Confirm it disappears from the list and a re-fetch (reload the page) still shows it gone.

- [ ] **Step 6: Log in as a Kasir-role user** (or a role you've stripped `expenses` from via Role & Izin) and confirm "Beban Umum" is absent from the sidebar, and a direct navigation to `/expenses` doesn't let them create/see the "Catat Beban" button (page-level `can()` gating).

- [ ] **Step 7: Note the outcome to the user** — this step can't be automated by an agent; report what you saw (screenshots if the harness supports it) rather than claiming success without having actually looked.

---

### Task 10: Final full-repo check

- [ ] **Step 1: Root-level checks**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: all pass, including the backend's 80%-line coverage gate.

- [ ] **Step 2: Review the diff**

Run: `git diff main --stat` (or `git log --oneline main..HEAD`) to confirm every task's commit is present and nothing unrelated slipped in (recall: there was a pre-existing stash on `claude/busy-ramanujan-cujt2s` from unrelated work — this branch (`feature/beban-umum`) was cut from `origin/main` and should not contain it).

- [ ] **Step 3: Hand off**

Follow `superpowers:finishing-a-development-branch` (or ask the user) for how they want this merged/PR'd — don't push or open a PR without asking first.
