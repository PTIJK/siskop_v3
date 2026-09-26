# Migrasi Saldo Awal (Opening-Balance Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SISKOP onboarding staff upload a filled `SISKOP_Template_Migrasi_v1.xlsx` into a client tenant as a **draft batch**, show the validation/reconciliation report, and let the client's own pengurus **approve**, which posts members, savings, loans and one opening-balance journal per unit, dated at the cutover.

**Architecture:** A new backend module `modules/migration/` holds a pure pipeline — `parser` (xlsx → typed payload) → `validate` (row and cross-sheet rules) → `reconcile` (Neraca = member detail + adjustments, opening balance nets to 0) — plus a `commit` step that writes everything in one DB transaction. Drafts live in a tenant-scoped `MigrationBatch` row (payload + report as JSON) in the production database; nothing touches live tables until the tenant approves. Platform admins can only create/discard drafts (`/api/platform/tenants/:tenantId/migrations`); only a tenant user with `migration.update` can commit (`/api/migration/:batchId/commit`).

**Tech Stack:** Express 4, Prisma 5 (PostgreSQL), zod, multer (memory storage), **exceljs** (new), vitest + supertest, React/Vite frontend, shared types in `@siskop/types`.

**Design references:** `docs/research/2026-09-26-client-data-migration-research.md`, `docs/migration/README.md`, `docs/migration/SISKOP_Template_Migrasi_v1.xlsx` (column contract).

---

## Scope and sub-plans

This feature has three independently shippable parts. Only **Plan A** is specified task-by-task here; B and C depend on A's API and types and get their own plan documents once A is merged.

| Plan | Delivers | Status |
|---|---|---|
| **A — Backend foundation** (this document) | Schema, parser, validation, reconciliation, commit, platform + tenant API | Ready to execute |
| **B — Platform Admin UI** | `/platform/tenants/:tenantId/migrasi`: upload, report view, discard, new version | Write after A merges (outline at end) |
| **C — Tenant approval UI** | `/migrasi`: side-by-side Neraca, adjustments, berita acara upload, *Setujui & Posting* | Write after A merges (outline at end) |

### Decisions locked in by this plan

1. **Batch lifecycle:** `DRAFT → COMMITTED` or `DRAFT → DISCARDED`. "Validated" and "reconciled" are properties of the stored report (`report.ready`), not states. Uploading a new version auto-discards the previous draft.
2. **Empty tenants only (v1):** commit is refused if the tenant already has members (`TENANT_NOT_EMPTY`). Catch-up batches for live tenants are out of scope.
3. **GL comes from the Neraca sheet only.** Member savings/loans are sub-ledger rows; they are *not* journaled individually. Reconciliation guarantees they add up to the Neraca line. Each unit bucket's opening entry is balanced against the clearing account **3-9990 Saldo Awal Migrasi**; the residual across all buckets equals `report.saldoAwalMigrasi` (≤ tolerance).
4. **KYC:** `Member.nik` and `Member.birthDate` become nullable (they drive portal login and the default password). `address`, `birthPlace`, `occupation` stay non-null and are stored as `""` when unknown. Portal activation refuses a member without NIK/birth date.
5. **Units are matched by name:** `Unit.namaUnit` in the file must equal an existing active `CooperativeUnit.name` (case-insensitive). v1 does not create units.
6. **Account mappings are not created by migration.** New SavingConfig/LoanConfig rows start without `AccountMapping`s; the tenant sets them in *Konfigurasi → Mapping Akun* before posting live transactions (existing `UnpostedJournalBanner` covers the gap). Plan C shows this as a post-commit checklist item, together with marking cash accounts `isCashEquivalent`.
7. **Loans:** stored with their *remaining* state: `principalAmount = sisaPokok`, `totalAmount = remainingAmount = sisaPokok + sisaMarginBunga`, `termMonths = sisaAngsuranBulan`, `disbursedAt = tanggalCair ?? cutover`. Same convention as `scripts/import-kopkar-umsurabaya.ts`.
8. **Platform exception to CLAUDE.md rule 1:** the platform upload route takes `tenantId` from the URL, like the existing `/api/platform/tenants/:id` routes. It may only write `MigrationBatch` rows with status `DRAFT`/`DISCARDED`. Commit reads `tenantId` from `req.auth` only. Task 13 documents this in CLAUDE.md.
9. **Not imported in v1:** `Aset_Tetap` sheet (no asset model), `noHp`, `tanggalMasuk`, `noKontrak`, `catatan` columns. They stay in the archived batch payload.

## File structure

**Create (backend)**

| File | Responsibility |
|---|---|
| `apps/backend/src/modules/migration/columns.ts` | Sheet names, column contract, info keys, enum lists, clearing-account constant |
| `apps/backend/src/modules/migration/issues.ts` | `issue()` constructor for `MigrationIssue` |
| `apps/backend/src/modules/migration/cells.ts` | exceljs cell flattening, typed converters, `RowReader` |
| `apps/backend/src/modules/migration/parser.ts` | `parseWorkbook(buffer)` → `{ payload, issues }` |
| `apps/backend/src/modules/migration/validate.ts` | `validatePayload(payload, context)`, `normalizeName()` |
| `apps/backend/src/modules/migration/reconcile.ts` | `buildReport(payload, issues)` |
| `apps/backend/src/modules/migration/commit.ts` | `commitPayload(tx, args)`: accounts, configs, members, savings, loans, opening journal |
| `apps/backend/src/modules/migration/service.ts` | `loadContext`, `analyse`, `createDraftBatch`, `getCurrentBatch`, `discardBatch`, `commitBatch`, `toSummary` |
| `apps/backend/src/modules/migration/upload.ts` | multer memory upload, `requireFile`, `storeBeritaAcara` |
| `apps/backend/src/modules/migration/platform.routes.ts` | Platform draft routes (mounted under `/api/platform`) |
| `apps/backend/src/modules/migration/routes.ts` | Tenant routes (`/api/migration`) |
| `apps/backend/tests/fixtures/migration-workbook.ts` | Builds template-shaped xlsx buffers for tests |
| `apps/backend/tests/migration-*.test.ts` | One file per unit (see tasks) |
| `packages/types/src/migration.ts` | All migration wire/payload types |

**Modify**

| File | Change |
|---|---|
| `apps/backend/prisma/schema.prisma` | Enums, `MigrationBatch`, nullable `nik`/`birthDate`, `legacyMemberNo`, `migrationBatchId` |
| `apps/backend/src/lib/tenant-scope.ts` | Add `"MigrationBatch"` to `TENANT_SCOPED_MODELS` |
| `apps/backend/src/lib/journal.ts` | Export `JournalLineInput`, add `postOpeningBalance` |
| `apps/backend/src/lib/id-generator.ts` | Add `memberIdAllocator` (in-transaction sequence) |
| `apps/backend/src/lib/file-sniff.ts` | Recognise ZIP (xlsx) signature |
| `apps/backend/src/modules/member-auth/service.ts` | Refuse portal activation without NIK/birth date |
| `apps/backend/src/modules/tenants/provision.ts` | Seed `migration` permissions |
| `apps/backend/src/modules/platform/routes.ts` | Mount platform migration router |
| `apps/backend/src/app.ts` | Mount `/api/migration` |
| `packages/types/src/index.ts`, `role.ts`, `member.ts`, `savings.ts` | Export migration types, `migration` permission module, nullable KYC, `OPENING_BALANCE` |
| `apps/frontend/src/components/savings/SavingStatement.tsx` | Label for `OPENING_BALANCE` |
| `apps/frontend/src/pages/members/MemberFormPage.tsx`, `MemberDetailPage.tsx` | Handle `nik: null` |
| `CLAUDE.md` | Document the platform-draft exception |

---

## Task 0: Branch and dependency

**Files:** `apps/backend/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Branch from the latest main**

```bash
git fetch origin main && git checkout -b feature/migrasi-saldo-awal origin/main
```

- [ ] **Step 2: Add exceljs to the backend**

```bash
pnpm --filter @siskop/backend add exceljs@^4.4.0
```

Expected: `apps/backend/package.json` lists `"exceljs": "^4.4.0"` under dependencies. exceljs ships its own TypeScript types.

- [ ] **Step 3: Confirm the baseline is green**

```bash
pnpm run typecheck && pnpm --filter @siskop/backend test
```

Expected: PASS. If not, stop and report; do not build on a red baseline.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): add exceljs for migration workbook parsing"
```

---

## Task 1: Shared types

**Files:**
- Create: `packages/types/src/migration.ts`
- Modify: `packages/types/src/index.ts`, `packages/types/src/role.ts`, `packages/types/src/member.ts`, `packages/types/src/savings.ts`

- [ ] **Step 1: Create `packages/types/src/migration.ts`**

```ts
// Opening-balance migration ("Migrasi Saldo Awal"). The payload mirrors the
// column contract of docs/migration/SISKOP_Template_Migrasi_v1.xlsx. Money is
// a decimal string with 2 places ("1234.50"), never a number (CLAUDE.md rule 2).
// Every row carries `row`: its 1-based row number in the source sheet, so an
// issue can point the operator at the exact Excel row.

export type MigrationBatchStatus = "DRAFT" | "COMMITTED" | "DISCARDED";

export type MigrationIssueSeverity = "ERROR" | "WARNING";

export type MigrationIssueCode =
  | "INVALID_FILE"
  | "MISSING_SHEET"
  | "MISSING_COLUMN"
  | "REQUIRED"
  | "INVALID_VALUE"
  | "DUPLICATE"
  | "INVALID_NIK"
  | "UNKNOWN_UNIT"
  | "UNKNOWN_ACCOUNT"
  | "UNKNOWN_PRODUCT"
  | "UNKNOWN_MEMBER"
  | "NEGATIVE_BALANCE"
  | "ACCOUNT_CONFLICT"
  | "TENANT_NOT_EMPTY"
  | "ADJUSTMENT_NOT_APPROVED"
  | "INSTALLMENT_MISMATCH"
  | "RECONCILIATION_MISMATCH"
  | "UNBALANCED_OPENING";

export interface MigrationIssue {
  severity: MigrationIssueSeverity;
  sheet: string;
  /** Excel row number; null for sheet-level or batch-level issues. */
  row: number | null;
  column: string | null;
  code: MigrationIssueCode;
  message: string;
}

export interface MigrationInfo {
  namaKoperasi: string;
  subdomain: string | null;
  jenisKoperasi: "SYARIAH" | "KONVENSIONAL";
  /** ISO date `YYYY-MM-DD`; "" when missing/invalid (an issue is raised). */
  tanggalCutover: string;
  sumberData: "LEGACY" | "EXCEL" | "PDF" | "CAMPURAN" | null;
  toleransiSelisih: string;
  versiBatch: string | null;
}

export type MigrationUnitType = "KSP" | "KONSUMEN" | "PRODUSEN" | "JASA" | "PEMASARAN";
export type MigrationAccountCategory = "ASET" | "KEWAJIBAN" | "EKUITAS";
export type MigrationNormalBalance = "DEBIT" | "KREDIT";
export type MigrationEquityClass =
  | "SIMPANAN_POKOK"
  | "SIMPANAN_WAJIB"
  | "MODAL_TETAP"
  | "CADANGAN_UMUM"
  | "CADANGAN_RISIKO"
  | "HIBAH"
  | "MODAL_PENYERTAAN"
  | "SHU"
  | "EKUITAS_LAIN";
export type MigrationRateType = "BUNGA" | "BAGI_HASIL" | "MARGIN" | "HARIAN";
export type MigrationKol = "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET";

export interface MigrationUnitRow {
  row: number;
  kodeUnit: string;
  namaUnit: string;
  jenisUnit: MigrationUnitType;
}

export interface MigrationNeracaRow {
  row: number;
  kodeAkun: string;
  namaAkun: string;
  kategori: MigrationAccountCategory;
  saldoNormal: MigrationNormalBalance;
  kelasEkuitas: MigrationEquityClass | null;
  /** null = tenant-level (unallocated) bucket. */
  kodeUnit: string | null;
  saldo: string;
  namaDiSumber: string;
}

export interface MigrationProdukRow {
  row: number;
  kodeProduk: string;
  namaProduk: string;
  jenis: "SIMPANAN" | "PEMBIAYAAN";
  jenisSimpanan: "POKOK" | "WAJIB" | "SUKARELA" | null;
  jenisPembiayaan: "SYARIAH" | "KONVENSIONAL" | null;
  tipeImbalan: MigrationRateType;
  tarifPersen: string;
  periode: "DAILY" | "MONTHLY" | "YEARLY" | null;
  tenorMaksBulan: number | null;
  kodeAkun: string;
  kodeUnit: string;
  namaDiSumber: string;
}

export interface MigrationAnggotaRow {
  row: number;
  noAnggotaLama: string;
  namaLengkap: string;
  nik: string | null;
  alamat: string | null;
  tempatLahir: string | null;
  tanggalLahir: string | null;
  pekerjaan: string | null;
  noHp: string | null;
  tanggalMasuk: string | null;
  status: "AKTIF" | "KELUAR";
  pengurus: boolean;
  pengawas: boolean;
  kodeUnit: string;
  catatan: string | null;
}

export interface MigrationSimpananRow {
  row: number;
  noAnggotaLama: string;
  kodeProduk: string;
  saldo: string;
  catatan: string | null;
}

export interface MigrationPembiayaanRow {
  row: number;
  noAnggotaLama: string;
  kodeProduk: string;
  noKontrak: string | null;
  tanggalCair: string | null;
  pokokAwal: string | null;
  tenorBulan: number | null;
  sisaPokok: string;
  sisaMarginBunga: string | null;
  angsuranPokok: string | null;
  angsuranMarginBunga: string | null;
  sisaAngsuranBulan: number;
  hariTunggakan: number | null;
  kolektibilitas: MigrationKol;
  kodeAkunKhusus: string | null;
  catatan: string | null;
}

export interface MigrationPenyesuaianRow {
  row: number;
  kodeAkun: string;
  /** Part of the Neraca balance with no member-level detail, in the account's normal-balance direction. */
  jumlah: string;
  alasan: string;
  buktiSumber: string | null;
  disetujuiOleh: string | null;
  tanggalPersetujuan: string | null;
}

export interface MigrationPayload {
  info: MigrationInfo;
  units: MigrationUnitRow[];
  neraca: MigrationNeracaRow[];
  produk: MigrationProdukRow[];
  anggota: MigrationAnggotaRow[];
  simpanan: MigrationSimpananRow[];
  pembiayaan: MigrationPembiayaanRow[];
  penyesuaian: MigrationPenyesuaianRow[];
}

export interface MigrationAccountCheck {
  kodeAkun: string;
  namaAkun: string;
  saldoNeraca: string;
  rincianSimpanan: string;
  rincianPembiayaan: string;
  penyesuaian: string;
  /** null when the account has no member-level detail at all. */
  selisih: string | null;
  status: "COCOK" | "SELISIH" | "TANPA_RINCIAN";
}

export interface MigrationReport {
  memberCount: number;
  membersWithoutNik: number;
  savingRowCount: number;
  loanRowCount: number;
  totalDebit: string;
  totalKredit: string;
  /** totalDebit − totalKredit; must be within `toleransi`. */
  saldoAwalMigrasi: string;
  toleransi: string;
  accounts: MigrationAccountCheck[];
  issues: MigrationIssue[];
  /** true when no issue has severity ERROR. */
  ready: boolean;
}

export interface MigrationBatchSummary {
  id: string;
  status: MigrationBatchStatus;
  version: number;
  sourceFileName: string;
  cutoverDate: string | null;
  report: MigrationReport;
  uploadedByName: string;
  createdAt: string;
  committedByName: string | null;
  committedAt: string | null;
  beritaAcaraUrl: string | null;
}
```

- [ ] **Step 2: Export it from `packages/types/src/index.ts`**

Add next to the other `export * from` lines:

```ts
export * from "./migration.js";
```

(Match the existing extension style in that file — if the other lines omit `.js`, omit it too.)

- [ ] **Step 3: Add the permission module in `packages/types/src/role.ts`**

In `interface Permissions`, after `konsumen?: ModulePermissions;`:

```ts
  // Migrasi Saldo Awal — `read` views the draft batch report, `update`
  // approves and posts it. Optional like `accounting`/`konsumen` so role blobs
  // seeded before this module existed still parse.
  migration?: ModulePermissions;
```

- [ ] **Step 4: Make KYC fields nullable in `packages/types/src/member.ts`**

In `interface Member` replace:

```ts
  nik: string;
```

with

```ts
  /** null for a migrated member whose NIK was not in the source data (KYC pending). */
  nik: string | null;
```

and replace

```ts
  /** ISO date, e.g. `1985-03-15`. */
  birthDate: string;
```

with

```ts
  /** ISO date, e.g. `1985-03-15`; null when unknown (migrated member, KYC pending). */
  birthDate: string | null;
  legacyMemberNo: string | null;
```

- [ ] **Step 5: Add the transaction type in `packages/types/src/savings.ts`**

```ts
export type SavingTransactionType = "DEPOSIT" | "WITHDRAWAL" | "INTEREST" | "OPENING_BALANCE";
```

- [ ] **Step 6: Run typecheck to surface the fallout**

Run: `pnpm run typecheck`
Expected: FAIL in the frontend at `SavingStatement.tsx` (`TYPE_LABEL` missing `OPENING_BALANCE`) and `MemberFormPage.tsx` (`nik: m.nik` not assignable to `string`). Backend errors are fixed in Task 2 after the Prisma client is regenerated.

- [ ] **Step 7: Fix the frontend fallout**

`apps/frontend/src/components/savings/SavingStatement.tsx`, inside `TYPE_LABEL`:

```ts
  OPENING_BALANCE: "Saldo Awal",
```

`apps/frontend/src/pages/members/MemberFormPage.tsx`, in the `reset({...})` call:

```ts
          nik: m.nik ?? "",
```

`apps/frontend/src/pages/members/MemberDetailPage.tsx`: replace both `member.nik` renders:

```tsx
                  { label: "NIK", value: member.nik ?? "Belum dilengkapi" },
```

```tsx
                <p className="font-mono font-semibold">{member.nik ?? "Belum dilengkapi"}</p>
```

- [ ] **Step 8: Run the frontend typecheck**

Run: `pnpm --filter @siskop/frontend typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/types apps/frontend/src
git commit -m "feat(types): migration payload/report types, migration permission, nullable member KYC"
```

---

## Task 2: Prisma schema and migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`, `apps/backend/src/lib/tenant-scope.ts`
- Create: `apps/backend/prisma/migrations/<timestamp>_migration_batch/migration.sql` (generated, then edited)
- Test: `apps/backend/tests/migration-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-schema.test.ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/lib/db.js";
import { setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/migrations");

function backfillStatements(): string[] {
  const dir = readdirSync(migrationsDir).find((d) => d.endsWith("_migration_batch"));
  if (!dir) throw new Error("migration_batch migration not found");
  const sql = readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8");
  const block = sql.split("-- backfill:start")[1]?.split("-- backfill:end")[0] ?? "";
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("migration schema", () => {
  it("stores a member without NIK or birth date, with its legacy number", async () => {
    const { user } = await setupTenant();
    const member = await db.member.create({
      data: {
        tenantId: user.tenantId,
        memberId: "KOP-DEMO-TEST-0001",
        accountNumber: "ACC-TEST-0001",
        legacyMemberNo: "226-A",
        fullName: "Dwi Pri H",
        nik: null,
        address: "",
        birthPlace: "",
        birthDate: null,
        occupation: ""
      }
    });
    expect(member.nik).toBeNull();
    expect(member.birthDate).toBeNull();
    expect(member.legacyMemberNo).toBe("226-A");
  });

  it("allows several members without NIK in one tenant", async () => {
    const { user } = await setupTenant();
    for (const n of [1, 2]) {
      await db.member.create({
        data: {
          tenantId: user.tenantId,
          memberId: `KOP-DEMO-TEST-000${n}`,
          accountNumber: `ACC-TEST-000${n}`,
          fullName: `Anggota ${n}`,
          address: "",
          birthPlace: "",
          occupation: ""
        }
      });
    }
    expect(await db.member.count({ where: { tenantId: user.tenantId, nik: null } })).toBe(2);
  });

  it("creates a draft migration batch scoped to the tenant", async () => {
    const { user } = await setupTenant();
    const batch = await db.migrationBatch.create({
      data: {
        tenantId: user.tenantId,
        version: 1,
        sourceFileName: "migrasi.xlsx",
        cutoverDate: new Date("2025-12-31T00:00:00Z"),
        payload: {},
        report: {},
        uploadedById: "u1",
        uploadedByName: "Tim Onboarding"
      }
    });
    expect(batch.status).toBe("DRAFT");
  });

  it("refuses an unscoped MigrationBatch query", async () => {
    await expect(db.migrationBatch.findMany({})).rejects.toThrow(/no tenantId filter/);
  });

  it("backfills migration permissions onto existing Super Admin and Manager roles", async () => {
    const { user } = await setupTenant();
    await db.$executeRawUnsafe(
      `UPDATE "Role" SET "permissions" = ("permissions"::jsonb - 'migration') WHERE "tenantId" = '${user.tenantId}'`
    );
    for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);

    const roles = await db.role.findMany({ where: { tenantId: user.tenantId } });
    const perms = (name: string) =>
      (roles.find((r) => r.name === name)?.permissions as Record<string, unknown>).migration;
    expect(perms("Super Admin")).toEqual({ read: true, update: true });
    expect(perms("Manager")).toEqual({ read: true });
    expect(perms("Teller")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-schema.test.ts`
Expected: FAIL — TypeScript/Prisma errors: `legacyMemberNo` unknown, `db.migrationBatch` undefined.

- [ ] **Step 3: Edit `apps/backend/prisma/schema.prisma`**

Add to `enum TransactionType` after `INTEREST`:

```prisma
  // Opening balance loaded by a Migrasi Saldo Awal batch, dated at the
  // cutover — not a cash movement, see modules/migration/commit.ts.
  OPENING_BALANCE
```

Add to `enum JournalSourceType` after `STOCK_MOVEMENT`:

```prisma
  // One entry per unit bucket per committed MigrationBatch (sourceId = batch id).
  OPENING_BALANCE
```

Add a new enum next to the others:

```prisma
enum MigrationBatchStatus {
  DRAFT
  COMMITTED
  DISCARDED
}
```

In `model Tenant`, add to the relation list:

```prisma
  migrationBatches MigrationBatch[]
```

In `model Member` change the KYC fields and add the new ones:

```prisma
  nik                String?
  address            String
  birthPlace         String
  birthDate          DateTime?
  occupation         String
  // Member number in the koperasi's previous books. Not unique: legacy
  // numbering reuses numbers (see docs/research/2026-09-26-...).
  legacyMemberNo     String?
  migrationBatchId   String?
  migrationBatch     MigrationBatch? @relation(fields: [migrationBatchId], references: [id], onDelete: SetNull)
```

(keep every other Member field unchanged; add `@@index([tenantId, legacyMemberNo])` to the Member block).

In `model Saving` and `model Loan` add:

```prisma
  migrationBatchId String?
  migrationBatch   MigrationBatch? @relation(fields: [migrationBatchId], references: [id], onDelete: SetNull)
```

Add the model (after `ModalSendiriAdjustment`):

```prisma
// A "Migrasi Saldo Awal" upload. DRAFT rows are created by platform staff
// (modules/migration/platform.routes.ts) and hold the parsed workbook and its
// reconciliation report as JSON; nothing touches Member/Saving/Loan/Journal
// until a tenant user with migration.update commits it. uploadedById /
// committedById are plain strings, not FKs: the uploader is a platform admin
// whose User row belongs to another tenant.
model MigrationBatch {
  id              String               @id @default(cuid())
  tenantId        String
  tenant          Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  status          MigrationBatchStatus @default(DRAFT)
  version         Int
  sourceFileName  String
  cutoverDate     DateTime?            @db.Date
  payload         Json
  report          Json
  uploadedById    String
  uploadedByName  String
  committedById   String?
  committedByName String?
  committedAt     DateTime?
  beritaAcaraUrl  String?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  members Member[]
  savings Saving[]
  loans   Loan[]

  @@index([tenantId, status])
}
```

- [ ] **Step 4: Generate the migration without applying it**

```bash
pnpm --filter @siskop/backend exec prisma migrate dev --name migration_batch --create-only
```

Expected: a new folder `apps/backend/prisma/migrations/<timestamp>_migration_batch/` with `migration.sql`.

- [ ] **Step 5: Append the role backfill to that `migration.sql`**

```sql
-- Existing tenants' seeded roles predate the migration permission module.
-- backfill:start
UPDATE "Role" SET "permissions" = jsonb_set("permissions"::jsonb, '{migration}', '{"read": true, "update": true}'::jsonb, true) WHERE "name" = 'Super Admin';
UPDATE "Role" SET "permissions" = jsonb_set("permissions"::jsonb, '{migration}', '{"read": true}'::jsonb, true) WHERE "name" = 'Manager';
-- backfill:end
```

- [ ] **Step 6: Apply the migration and regenerate the client**

```bash
pnpm --filter @siskop/backend db:migrate
```

Expected: "Your database is now in sync with your schema." Also apply it to the test database (the one `.env.test` points at), e.g. `DATABASE_URL=<test url> pnpm --filter @siskop/backend exec prisma migrate deploy`.

- [ ] **Step 7: Register the model with the tenant guard**

`apps/backend/src/lib/tenant-scope.ts`, append to `TENANT_SCOPED_MODELS` (before the closing `]`):

```ts
  // Migrasi Saldo Awal — drafts are written by platform staff with the
  // tenantId taken from the URL; every query still names it explicitly.
  "MigrationBatch"
```

(add a comma after the previous last entry `"TenantNotification"`).

- [ ] **Step 8: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/prisma apps/backend/src/lib/tenant-scope.ts apps/backend/tests/migration-schema.test.ts
git commit -m "feat(db): MigrationBatch model, OPENING_BALANCE types, nullable member KYC"
```

---

## Task 3: Nullable-KYC fallout in the backend

**Files:**
- Modify: `apps/backend/src/modules/member-auth/service.ts:59-76`, `apps/backend/src/modules/members/service.ts` (`memberSelect`)
- Test: `apps/backend/tests/member-auth.test.ts`, `apps/backend/tests/members.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `tests/member-auth.test.ts`, reusing that file's existing imports/helpers `db`, `setupTenant`, `activatePortalAccess`; add any that are missing)

```ts
describe("activatePortalAccess without KYC", () => {
  it("refuses a member whose NIK or birth date is missing", async () => {
    const { user } = await setupTenant();
    const member = await db.member.create({
      data: {
        tenantId: user.tenantId,
        memberId: "KOP-DEMO-KYC-0001",
        accountNumber: "ACC-KYC-0001",
        fullName: "Tanpa NIK",
        address: "",
        birthPlace: "",
        occupation: ""
      }
    });
    await expect(activatePortalAccess(user.tenantId, member.id)).rejects.toThrow(
      /VALIDATION_ERROR: Lengkapi NIK dan tanggal lahir/
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/member-auth.test.ts -t "without KYC"`
Expected: FAIL (TypeScript error: `member.birthDate` is `Date | null` passed to `defaultPasswordFromBirthDate`, or a runtime TypeError).

- [ ] **Step 3: Implement the guard** in `activatePortalAccess`, right after the `notFound` check:

```ts
  if (!member.nik || !member.birthDate) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Lengkapi NIK dan tanggal lahir anggota sebelum mengaktifkan akses portal"
    );
  }
```

and change the next line to use the narrowed value:

```ts
  const defaultPassword = defaultPasswordFromBirthDate(member.birthDate);
```

(ensure `AppError` and `ErrorCode` are imported at the top of the file: `import { AppError, notFound } from "../../lib/errors.js";` and `import { ErrorCode } from "@siskop/types";`).

- [ ] **Step 4: Run the backend typecheck and fix any remaining nullable errors**

Run: `pnpm --filter @siskop/backend typecheck`
Expected: PASS. If another site reports `string | null` not assignable to `string` for `nik`/`birthDate`, narrow it the same way (throw a `VALIDATION_ERROR` where the value is required, render `?? ""` where it is display-only). Do not change the create/update schemas: staff-created members still require NIK and birth date.

- [ ] **Step 5: Return the legacy number from the members API**

In `apps/backend/src/modules/members/service.ts`, add to the `memberSelect` object (next to `nik: true`):

```ts
  legacyMemberNo: true,
```

and append to `tests/members.test.ts`:

```ts
it("returns legacyMemberNo (null for members created in-app)", async () => {
  const admin = await setupTenant();
  const member = await createMemberAs(admin.accessToken);
  const res = await request(app()).get(`/api/members/${member.id}`).set("Authorization", `Bearer ${admin.accessToken}`);
  expect(res.body.data.legacyMemberNo).toBeNull();
});
```

(reuse that file's existing imports; add `createMemberAs` from `./helpers.js` if missing).

- [ ] **Step 6: Run the member tests**

Run: `pnpm --filter @siskop/backend exec vitest run tests/member-auth.test.ts tests/members.test.ts tests/member-access.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/member-auth/service.ts apps/backend/src/modules/members/service.ts apps/backend/tests/member-auth.test.ts apps/backend/tests/members.test.ts
git commit -m "fix(member-auth): refuse portal activation for members without NIK or birth date"
```

---

## Task 4: Seed migration permissions for new tenants

**Files:**
- Modify: `apps/backend/src/modules/tenants/provision.ts` (`SEED_ROLES`)
- Test: `apps/backend/tests/migration-schema.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append inside the `describe("migration schema")` block)

```ts
  it("seeds migration permissions on newly provisioned tenants", async () => {
    const { user } = await setupTenant();
    const roles = await db.role.findMany({ where: { tenantId: user.tenantId } });
    const perms = (name: string) =>
      (roles.find((r) => r.name === name)?.permissions as Record<string, unknown>).migration;
    expect(perms("Super Admin")).toEqual({ read: true, update: true });
    expect(perms("Manager")).toEqual({ read: true });
    expect(perms("Teller")).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-schema.test.ts -t "seeds migration"`
Expected: FAIL — `perms("Super Admin")` is `undefined`.

- [ ] **Step 3: Implement** — in `SEED_ROLES`, Super Admin permissions, after `konsumen: FULL`:

```ts
      konsumen: FULL,
      migration: { read: true, update: true }
```

and Manager, after its `konsumen: FULL`:

```ts
      konsumen: FULL,
      migration: { read: true }
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-schema.test.ts tests/provision-tenant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/tenants/provision.ts apps/backend/tests/migration-schema.test.ts
git commit -m "feat(roles): seed migration read/approve permissions"
```

---

## Task 5: Column contract, issues and cell converters

**Files:**
- Create: `apps/backend/src/modules/migration/columns.ts`, `issues.ts`, `cells.ts`
- Test: `apps/backend/tests/migration-cells.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-cells.test.ts
import { describe, it, expect } from "vitest";
import type { MigrationIssue } from "@siskop/types";
import { rawValue, toMoney, toDate, toInt, toText, RowReader } from "../src/modules/migration/cells.js";

describe("rawValue", () => {
  it("flattens exceljs formula results, rich text and blanks", () => {
    expect(rawValue({ formula: "A1+1", result: 5 })).toBe(5);
    expect(rawValue({ richText: [{ text: "Ani " }, { text: "S" }] })).toBe("Ani S");
    expect(rawValue("   ")).toBeNull();
    expect(rawValue(undefined)).toBeNull();
    expect(rawValue({ error: "#N/A" })).toBeNull();
  });
});

describe("toMoney", () => {
  it("keeps cents from a float cell without float noise", () => {
    expect(toMoney(280654800.33)).toEqual({ ok: true, value: "280654800.33" });
    expect(toMoney(0.1 + 0.2)).toEqual({ ok: true, value: "0.30" });
  });
  it("accepts a plain numeric string and negatives", () => {
    expect(toMoney("-527501000")).toEqual({ ok: true, value: "-527501000.00" });
  });
  it("rejects Rupiah formatting", () => {
    expect(toMoney("Rp 1.000.000").ok).toBe(false);
    expect(toMoney("1,000,000").ok).toBe(false);
  });
  it("rejects more than two decimals in text", () => {
    expect(toMoney("1.234").ok).toBe(false);
  });
});

describe("toDate / toInt / toText", () => {
  it("reads Date cells and Indonesian dd/mm/yyyy text as ISO dates", () => {
    expect(toDate(new Date("2025-12-31T00:00:00Z"))).toEqual({ ok: true, value: "2025-12-31" });
    expect(toDate("31/12/2025")).toEqual({ ok: true, value: "2025-12-31" });
    expect(toDate("2025-12-31")).toEqual({ ok: true, value: "2025-12-31" });
    expect(toDate("31/02/2025").ok).toBe(false);
  });
  it("reads whole numbers only", () => {
    expect(toInt(34)).toEqual({ ok: true, value: 34 });
    expect(toInt("12")).toEqual({ ok: true, value: 12 });
    expect(toInt(1.5).ok).toBe(false);
  });
  it("turns numeric member numbers into text", () => {
    expect(toText(118)).toBe("118");
    expect(toText(" 226-A ")).toBe("226-A");
  });
});

describe("RowReader", () => {
  it("records REQUIRED and INVALID_VALUE issues with sheet, row and column", () => {
    const issues: MigrationIssue[] = [];
    const r = new RowReader("Simpanan", 7, { noAnggotaLama: null, saldo: "Rp 5" }, issues);
    expect(r.text("noAnggotaLama", true)).toBeNull();
    expect(r.money("saldo", true)).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({ sheet: "Simpanan", row: 7, column: "noAnggotaLama", code: "REQUIRED" }),
      expect.objectContaining({ sheet: "Simpanan", row: 7, column: "saldo", code: "INVALID_VALUE" })
    ]);
  });
  it("reads Y/N flags, defaulting to false", () => {
    const issues: MigrationIssue[] = [];
    const r = new RowReader("Anggota", 2, { pengurus: "Y", pengawas: null }, issues);
    expect(r.yesNo("pengurus")).toBe(true);
    expect(r.yesNo("pengawas")).toBe(false);
    expect(issues).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-cells.test.ts`
Expected: FAIL — module `../src/modules/migration/cells.js` not found.

- [ ] **Step 3: Create `apps/backend/src/modules/migration/columns.ts`**

```ts
/**
 * Column contract of docs/migration/SISKOP_Template_Migrasi_v1.xlsx. Row 1 of
 * each data sheet holds these exact keys; columns starting with "_" in the
 * template are formula helpers and are never read. Change this file and the
 * template generator (docs/migration/build_template.py) together.
 */
export const INFO_SHEET = "Info_Koperasi";

export const SHEET_COLUMNS = {
  Unit: ["kodeUnit", "namaUnit", "jenisUnit"],
  Neraca: ["kodeAkun", "namaAkun", "kategori", "saldoNormal", "kelasEkuitas", "kodeUnit", "saldo", "namaDiSumber"],
  Produk: [
    "kodeProduk", "namaProduk", "jenis", "jenisSimpanan", "jenisPembiayaan", "tipeImbalan",
    "tarifPersen", "periode", "tenorMaksBulan", "kodeAkun", "kodeUnit", "namaDiSumber"
  ],
  Anggota: [
    "noAnggotaLama", "namaLengkap", "nik", "alamat", "tempatLahir", "tanggalLahir", "pekerjaan",
    "noHp", "tanggalMasuk", "status", "pengurus", "pengawas", "kodeUnit", "catatan"
  ],
  Simpanan: ["noAnggotaLama", "namaAnggota", "kodeProduk", "saldo", "catatan"],
  Pembiayaan: [
    "noAnggotaLama", "namaAnggota", "kodeProduk", "noKontrak", "tanggalCair", "pokokAwal", "tenorBulan",
    "sisaPokok", "sisaMarginBunga", "angsuranPokok", "angsuranMarginBunga", "sisaAngsuranBulan",
    "hariTunggakan", "kolektibilitas", "kodeAkunKhusus", "catatan"
  ],
  Penyesuaian: ["kodeAkun", "jumlah", "alasan", "buktiSumber", "disetujuiOleh", "tanggalPersetujuan"]
} as const;

export type DataSheet = keyof typeof SHEET_COLUMNS;

export const UNIT_TYPES = ["KSP", "KONSUMEN", "PRODUSEN", "JASA", "PEMASARAN"] as const;
export const ACCOUNT_CATEGORIES = ["ASET", "KEWAJIBAN", "EKUITAS"] as const;
export const NORMAL_BALANCES = ["DEBIT", "KREDIT"] as const;
export const EQUITY_CLASSES = [
  "SIMPANAN_POKOK", "SIMPANAN_WAJIB", "MODAL_TETAP", "CADANGAN_UMUM", "CADANGAN_RISIKO",
  "HIBAH", "MODAL_PENYERTAAN", "SHU", "EKUITAS_LAIN"
] as const;
export const PRODUCT_KINDS = ["SIMPANAN", "PEMBIAYAAN"] as const;
export const SAVING_KINDS = ["POKOK", "WAJIB", "SUKARELA"] as const;
export const LOAN_KINDS = ["SYARIAH", "KONVENSIONAL"] as const;
export const RATE_TYPES = ["BUNGA", "BAGI_HASIL", "MARGIN", "HARIAN"] as const;
export const PERIODS = ["DAILY", "MONTHLY", "YEARLY"] as const;
export const KOL = ["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"] as const;
export const MEMBER_STATUS = ["AKTIF", "KELUAR"] as const;
export const COOP_TYPES = ["SYARIAH", "KONVENSIONAL"] as const;
export const DATA_SOURCES = ["LEGACY", "EXCEL", "PDF", "CAMPURAN"] as const;

/** Clearing account every opening entry balances against; must end at ~0. */
export const CLEARING_ACCOUNT = {
  code: "3-9990",
  name: "Saldo Awal Migrasi",
  category: "EKUITAS",
  normalBalance: "KREDIT",
  equityClass: "EKUITAS_LAIN"
} as const;
```

- [ ] **Step 4: Create `apps/backend/src/modules/migration/issues.ts`**

```ts
import type { MigrationIssue, MigrationIssueCode, MigrationIssueSeverity } from "@siskop/types";

export function issue(
  sheet: string,
  row: number | null,
  column: string | null,
  code: MigrationIssueCode,
  message: string,
  severity: MigrationIssueSeverity = "ERROR"
): MigrationIssue {
  return { severity, sheet, row, column, code, message };
}
```

- [ ] **Step 5: Create `apps/backend/src/modules/migration/cells.ts`**

```ts
import { Prisma } from "@prisma/client";
import type { MigrationIssue } from "@siskop/types";
import { issue } from "./issues.js";

export type Raw = string | number | boolean | Date | null;
type Conv<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Conv<T> => ({ ok: true, value });
const bad = <T>(message: string): Conv<T> => ({ ok: false, message });

/** Flattens an exceljs cell value (formula result, rich text, hyperlink, error) to a primitive; blank → null. */
export function rawValue(v: unknown): Raw {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return null;
    if ("result" in o) return rawValue(o.result);
    if (Array.isArray(o.richText)) return rawValue((o.richText as Array<{ text: string }>).map((t) => t.text).join(""));
    if ("text" in o) return rawValue(o.text);
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toText(v: Raw): string | null {
  if (v === null) return null;
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function toMoney(v: Raw): Conv<string> {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return bad("Angka tidak valid");
    return ok(new Prisma.Decimal(String(v)).toDecimalPlaces(2).toFixed(2));
  }
  const s = String(v).trim();
  if (!PLAIN_NUMBER.test(s)) return bad(`"${s}" bukan angka murni — tanpa "Rp", titik/koma ribuan, atau spasi`);
  const d = new Prisma.Decimal(s);
  if (d.decimalPlaces() > 2) return bad(`"${s}" lebih dari 2 desimal`);
  return ok(d.toFixed(2));
}

export function toInt(v: Raw): Conv<number> {
  if (typeof v === "number") return Number.isInteger(v) ? ok(v) : bad(`${v} bukan bilangan bulat`);
  const s = String(v).trim();
  return /^\d+$/.test(s) ? ok(Number.parseInt(s, 10)) : bad(`"${s}" bukan bilangan bulat`);
}

export function toDate(v: Raw): Conv<string> {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? bad("Tanggal tidak valid") : ok(isoDate(v));
  const s = String(v).trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s) ?? null;
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  if (!iso) return bad(`"${s}" bukan tanggal dd/mm/yyyy`);
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === iso ? ok(iso) : bad(`"${s}" bukan tanggal yang valid`);
}

export function toEnum<T extends string>(v: Raw, allowed: readonly T[]): Conv<T> {
  const s = String(v).trim().toUpperCase();
  return (allowed as readonly string[]).includes(s) ? ok(s as T) : bad(`"${String(v)}" harus salah satu dari: ${allowed.join(", ")}`);
}

export function toYesNo(v: Raw): Conv<boolean> {
  const s = String(v).trim().toUpperCase();
  return s === "Y" ? ok(true) : s === "N" ? ok(false) : bad(`"${String(v)}" harus Y atau N`);
}

/** Reads one sheet row by column key, converting values and recording issues instead of throwing. */
export class RowReader {
  constructor(
    private readonly sheet: string,
    private readonly row: number | null,
    private readonly values: Record<string, Raw>,
    private readonly issues: MigrationIssue[]
  ) {}

  private convert<T>(column: string, required: boolean, fn: (v: Raw) => Conv<T>): T | null {
    const raw = this.values[column] ?? null;
    if (raw === null) {
      if (required) this.issues.push(issue(this.sheet, this.row, column, "REQUIRED", `${column} wajib diisi`));
      return null;
    }
    const result = fn(raw);
    if (!result.ok) {
      this.issues.push(issue(this.sheet, this.row, column, "INVALID_VALUE", result.message));
      return null;
    }
    return result.value;
  }

  text(column: string, required = false): string | null {
    return this.convert(column, required, (v) => ok(toText(v) ?? ""));
  }

  money(column: string, required = false): string | null {
    return this.convert(column, required, toMoney);
  }

  int(column: string, required = false): number | null {
    return this.convert(column, required, toInt);
  }

  date(column: string, required = false): string | null {
    return this.convert(column, required, toDate);
  }

  enumOf<T extends string>(column: string, allowed: readonly T[], required = false): T | null {
    return this.convert(column, required, (v) => toEnum(v, allowed));
  }

  yesNo(column: string): boolean {
    return this.convert(column, false, toYesNo) ?? false;
  }
}
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-cells.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/migration/columns.ts apps/backend/src/modules/migration/issues.ts apps/backend/src/modules/migration/cells.ts apps/backend/tests/migration-cells.test.ts
git commit -m "feat(migration): column contract and cell converters"
```

---

## Task 6: Test workbook fixture and parser

**Files:**
- Create: `apps/backend/tests/fixtures/migration-workbook.ts`, `apps/backend/src/modules/migration/parser.ts`
- Test: `apps/backend/tests/migration-parser.test.ts`

The fixture's valid spec is a small, fully reconciling koperasi used by every later test:

| Account | Normal | Saldo | Detail |
|---|---|---|---|
| 1-1000 Kas | DEBIT | 1,000,000 | — |
| 1-1100 Piutang Pembiayaan | DEBIT | 3,000,000 | loans 2,000,000 + 1,000,000 |
| 2-1000 Simpanan Sukarela | KREDIT | 1,500,000 | SSK Ani 1,500,000 |
| 3-1000 Simpanan Pokok & Wajib | KREDIT | 2,000,000 | SPW Ani 1,200,000 + Budi 800,000 |
| 3-2000 Cadangan | KREDIT | 500,000 | — |

Debit 4,000,000 = Kredit 4,000,000.

- [ ] **Step 1: Create the fixture `apps/backend/tests/fixtures/migration-workbook.ts`**

```ts
import ExcelJS from "exceljs";
import { INFO_SHEET, SHEET_COLUMNS, type DataSheet } from "../../src/modules/migration/columns.js";

export type Cell = string | number | Date | null;
export type SheetRows = Array<Record<string, Cell>>;

export interface WorkbookSpec {
  info: Record<string, Cell>;
  sheets: Record<DataSheet, SheetRows>;
}

/** A small koperasi whose Neraca reconciles exactly with its member detail. */
export function validSpec(): WorkbookSpec {
  return {
    info: {
      namaKoperasi: "KSP Demo",
      subdomain: "demo",
      jenisKoperasi: "SYARIAH",
      tanggalCutover: new Date("2025-12-31T00:00:00Z"),
      sumberData: "EXCEL",
      toleransiSelisih: 1,
      versiBatch: "v1"
    },
    sheets: {
      // setupTenant() provisions one unit named "Simpan Pinjam".
      Unit: [{ kodeUnit: "KSP01", namaUnit: "Simpan Pinjam", jenisUnit: "KSP" }],
      Neraca: [
        { kodeAkun: "1-1000", namaAkun: "Kas", kategori: "ASET", saldoNormal: "DEBIT", kodeUnit: "KSP01", saldo: 1_000_000, namaDiSumber: "Kas" },
        { kodeAkun: "1-1100", namaAkun: "Piutang Pembiayaan", kategori: "ASET", saldoNormal: "DEBIT", kodeUnit: "KSP01", saldo: 3_000_000, namaDiSumber: "Piutang" },
        { kodeAkun: "2-1000", namaAkun: "Simpanan Sukarela", kategori: "KEWAJIBAN", saldoNormal: "KREDIT", kodeUnit: "KSP01", saldo: 1_500_000, namaDiSumber: "Sukarela" },
        { kodeAkun: "3-1000", namaAkun: "Simpanan Pokok & Wajib", kategori: "EKUITAS", saldoNormal: "KREDIT", kelasEkuitas: "SIMPANAN_WAJIB", kodeUnit: "KSP01", saldo: 2_000_000, namaDiSumber: "Pokok+Wajib" },
        { kodeAkun: "3-2000", namaAkun: "Cadangan", kategori: "EKUITAS", saldoNormal: "KREDIT", kelasEkuitas: "CADANGAN_UMUM", kodeUnit: null, saldo: 500_000, namaDiSumber: "Cadangan" }
      ],
      Produk: [
        { kodeProduk: "SPW", namaProduk: "Simpanan Pokok & Wajib", jenis: "SIMPANAN", jenisSimpanan: "POKOK", tipeImbalan: "BAGI_HASIL", tarifPersen: 0, periode: "MONTHLY", kodeAkun: "3-1000", kodeUnit: "KSP01", namaDiSumber: "SPW" },
        { kodeProduk: "SSK", namaProduk: "Tabungan Sukarela", jenis: "SIMPANAN", jenisSimpanan: "SUKARELA", tipeImbalan: "BAGI_HASIL", tarifPersen: 0, periode: "YEARLY", kodeAkun: "2-1000", kodeUnit: "KSP01", namaDiSumber: "SSK" },
        { kodeProduk: "MRB", namaProduk: "Pembiayaan Murabahah", jenis: "PEMBIAYAAN", jenisPembiayaan: "SYARIAH", tipeImbalan: "MARGIN", tarifPersen: 0, tenorMaksBulan: 60, kodeAkun: "1-1100", kodeUnit: "KSP01", namaDiSumber: "Pembiayaan" }
      ],
      Anggota: [
        { noAnggotaLama: 118, namaLengkap: "Ani Lestari", nik: "3578000000000001", tanggalLahir: new Date("1980-05-12T00:00:00Z"), status: "AKTIF", pengurus: "Y", pengawas: "N", kodeUnit: "KSP01" },
        { noAnggotaLama: "226-A", namaLengkap: "Budi Santoso", status: "AKTIF", kodeUnit: "KSP01", catatan: "no. 226 dipakai 2 orang" }
      ],
      Simpanan: [
        { noAnggotaLama: 118, kodeProduk: "SPW", saldo: 1_200_000 },
        { noAnggotaLama: "226-A", kodeProduk: "SPW", saldo: 800_000 },
        { noAnggotaLama: 118, kodeProduk: "SSK", saldo: 1_500_000 }
      ],
      Pembiayaan: [
        { noAnggotaLama: 118, kodeProduk: "MRB", sisaPokok: 2_000_000, sisaMarginBunga: 400_000, angsuranPokok: 200_000, angsuranMarginBunga: 40_000, sisaAngsuranBulan: 10, kolektibilitas: "LANCAR" },
        { noAnggotaLama: "226-A", kodeProduk: "MRB", sisaPokok: 1_000_000, angsuranPokok: 100_000, sisaAngsuranBulan: 10, kolektibilitas: "DALAM_PERHATIAN", hariTunggakan: 45 }
      ],
      Penyesuaian: []
    }
  };
}

/** Writes a workbook shaped like the template: Info_Koperasi keys in column B from row 5, values in C; data sheets with keys in row 1. */
export async function buildWorkbook(spec: WorkbookSpec, opts: { omitSheet?: DataSheet; omitColumn?: [DataSheet, string] } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet(INFO_SHEET);
  info.getCell("B4").value = "Kolom";
  info.getCell("C4").value = "Isi";
  Object.entries(spec.info).forEach(([key, value], i) => {
    info.getCell(`B${5 + i}`).value = key;
    info.getCell(`C${5 + i}`).value = value;
  });
  for (const sheet of Object.keys(SHEET_COLUMNS) as DataSheet[]) {
    if (opts.omitSheet === sheet) continue;
    const ws = wb.addWorksheet(sheet);
    const columns = SHEET_COLUMNS[sheet].filter((c) => !(opts.omitColumn?.[0] === sheet && opts.omitColumn[1] === c));
    ws.addRow([...columns, "_cek_otomatis"]);
    for (const row of spec.sheets[sheet]) ws.addRow([...columns.map((c) => row[c] ?? null), "OK"]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

- [ ] **Step 2: Write the failing test `apps/backend/tests/migration-parser.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseWorkbook } from "../src/modules/migration/parser.js";
import { buildWorkbook, validSpec } from "./fixtures/migration-workbook.js";

describe("parseWorkbook", () => {
  it("parses every sheet of a valid workbook into typed rows", async () => {
    const { payload, issues } = await parseWorkbook(await buildWorkbook(validSpec()));
    expect(issues).toEqual([]);
    expect(payload?.info).toMatchObject({ namaKoperasi: "KSP Demo", jenisKoperasi: "SYARIAH", tanggalCutover: "2025-12-31", toleransiSelisih: "1.00" });
    expect(payload?.neraca[0]).toMatchObject({ row: 2, kodeAkun: "1-1000", saldo: "1000000.00", saldoNormal: "DEBIT", kodeUnit: "KSP01" });
    expect(payload?.neraca[4]?.kodeUnit).toBeNull();
    expect(payload?.anggota[0]).toMatchObject({ noAnggotaLama: "118", nik: "3578000000000001", tanggalLahir: "1980-05-12", pengurus: true, pengawas: false });
    expect(payload?.anggota[1]).toMatchObject({ noAnggotaLama: "226-A", nik: null, tanggalLahir: null, pengurus: false });
    expect(payload?.simpanan).toHaveLength(3);
    expect(payload?.pembiayaan[1]).toMatchObject({ sisaPokok: "1000000.00", sisaMarginBunga: null, kolektibilitas: "DALAM_PERHATIAN", hariTunggakan: 45 });
    expect(payload?.penyesuaian).toEqual([]);
  });

  it("reports a missing sheet and returns no payload", async () => {
    const { payload, issues } = await parseWorkbook(await buildWorkbook(validSpec(), { omitSheet: "Pembiayaan" }));
    expect(payload).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ sheet: "Pembiayaan", code: "MISSING_SHEET" })]);
  });

  it("reports a missing column", async () => {
    const { payload, issues } = await parseWorkbook(await buildWorkbook(validSpec(), { omitColumn: ["Simpanan", "saldo"] }));
    expect(payload).toBeNull();
    expect(issues[0]).toMatchObject({ sheet: "Simpanan", code: "MISSING_COLUMN" });
  });

  it("keeps parsing but records row-level value errors", async () => {
    const spec = validSpec();
    spec.sheets.Simpanan[0]!.saldo = "Rp 1.200.000";
    spec.sheets.Anggota[0]!.status = "PINDAH";
    const { payload, issues } = await parseWorkbook(await buildWorkbook(spec));
    expect(payload).not.toBeNull();
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: "Simpanan", row: 2, column: "saldo", code: "INVALID_VALUE" }),
        expect.objectContaining({ sheet: "Anggota", row: 2, column: "status", code: "INVALID_VALUE" })
      ])
    );
  });

  it("rejects a file that is not an xlsx workbook", async () => {
    const { payload, issues } = await parseWorkbook(Buffer.from("not a workbook"));
    expect(payload).toBeNull();
    expect(issues[0]?.code).toBe("INVALID_FILE");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-parser.test.ts`
Expected: FAIL — `parser.js` not found.

- [ ] **Step 4: Create `apps/backend/src/modules/migration/parser.ts`**

```ts
import ExcelJS from "exceljs";
import type { MigrationInfo, MigrationIssue, MigrationPayload } from "@siskop/types";
import {
  ACCOUNT_CATEGORIES, COOP_TYPES, DATA_SOURCES, EQUITY_CLASSES, INFO_SHEET, KOL, LOAN_KINDS, MEMBER_STATUS,
  NORMAL_BALANCES, PERIODS, PRODUCT_KINDS, RATE_TYPES, SAVING_KINDS, SHEET_COLUMNS, UNIT_TYPES, type DataSheet
} from "./columns.js";
import { RowReader, rawValue, toText, type Raw } from "./cells.js";
import { issue } from "./issues.js";

export interface ParseResult {
  /** null when the workbook's structure is unusable (bad file, missing sheet/column). */
  payload: MigrationPayload | null;
  issues: MigrationIssue[];
}

interface TableRow {
  row: number;
  values: Record<string, Raw>;
}

function readTable(ws: ExcelJS.Worksheet, columns: readonly string[]): { missing: string[]; rows: TableRow[] } {
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const name = toText(rawValue(cell.value));
    if (name) header.set(name, col);
  });
  const missing = columns.filter((c) => !header.has(c));
  const rows: TableRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const excelRow = ws.getRow(r);
    const values: Record<string, Raw> = {};
    let hasValue = false;
    for (const c of columns) {
      const col = header.get(c);
      const v = col ? rawValue(excelRow.getCell(col).value) : null;
      values[c] = v;
      if (v !== null) hasValue = true;
    }
    if (hasValue) rows.push({ row: r, values });
  }
  return { missing, rows };
}

function readInfo(ws: ExcelJS.Worksheet, issues: MigrationIssue[]): MigrationInfo {
  const values: Record<string, Raw> = {};
  ws.eachRow((row) => {
    const key = toText(rawValue(row.getCell(2).value));
    if (key) values[key] = rawValue(row.getCell(3).value);
  });
  const x = new RowReader(INFO_SHEET, null, values, issues);
  return {
    namaKoperasi: x.text("namaKoperasi", true) ?? "",
    subdomain: x.text("subdomain"),
    jenisKoperasi: x.enumOf("jenisKoperasi", COOP_TYPES, true) ?? "KONVENSIONAL",
    tanggalCutover: x.date("tanggalCutover", true) ?? "",
    sumberData: x.enumOf("sumberData", DATA_SOURCES),
    toleransiSelisih: x.money("toleransiSelisih") ?? "1.00",
    versiBatch: x.text("versiBatch")
  };
}

export async function parseWorkbook(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { payload: null, issues: [issue(INFO_SHEET, null, null, "INVALID_FILE", "Berkas bukan workbook Excel (.xlsx) yang valid")] };
  }

  const issues: MigrationIssue[] = [];
  const infoSheet = wb.getWorksheet(INFO_SHEET);
  if (!infoSheet) issues.push(issue(INFO_SHEET, null, null, "MISSING_SHEET", `Sheet ${INFO_SHEET} tidak ditemukan`));

  const tables: Partial<Record<DataSheet, TableRow[]>> = {};
  for (const sheet of Object.keys(SHEET_COLUMNS) as DataSheet[]) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) {
      issues.push(issue(sheet, null, null, "MISSING_SHEET", `Sheet ${sheet} tidak ditemukan`));
      continue;
    }
    const { missing, rows } = readTable(ws, SHEET_COLUMNS[sheet]);
    if (missing.length > 0) {
      issues.push(issue(sheet, 1, null, "MISSING_COLUMN", `Kolom tidak ditemukan di baris 1: ${missing.join(", ")}`));
      continue;
    }
    tables[sheet] = rows;
  }
  if (!infoSheet || issues.length > 0) return { payload: null, issues };

  const rowsOf = (sheet: DataSheet) => (tables[sheet] ?? []).map((t) => ({ t, x: new RowReader(sheet, t.row, t.values, issues) }));

  const payload: MigrationPayload = {
    info: readInfo(infoSheet, issues),
    units: rowsOf("Unit").map(({ t, x }) => ({
      row: t.row,
      kodeUnit: x.text("kodeUnit", true) ?? "",
      namaUnit: x.text("namaUnit", true) ?? "",
      jenisUnit: x.enumOf("jenisUnit", UNIT_TYPES, true) ?? "KSP"
    })),
    neraca: rowsOf("Neraca").map(({ t, x }) => ({
      row: t.row,
      kodeAkun: x.text("kodeAkun", true) ?? "",
      namaAkun: x.text("namaAkun", true) ?? "",
      kategori: x.enumOf("kategori", ACCOUNT_CATEGORIES, true) ?? "ASET",
      saldoNormal: x.enumOf("saldoNormal", NORMAL_BALANCES, true) ?? "DEBIT",
      kelasEkuitas: x.enumOf("kelasEkuitas", EQUITY_CLASSES),
      kodeUnit: x.text("kodeUnit"),
      saldo: x.money("saldo", true) ?? "0.00",
      namaDiSumber: x.text("namaDiSumber", true) ?? ""
    })),
    produk: rowsOf("Produk").map(({ t, x }) => ({
      row: t.row,
      kodeProduk: x.text("kodeProduk", true) ?? "",
      namaProduk: x.text("namaProduk", true) ?? "",
      jenis: x.enumOf("jenis", PRODUCT_KINDS, true) ?? "SIMPANAN",
      jenisSimpanan: x.enumOf("jenisSimpanan", SAVING_KINDS),
      jenisPembiayaan: x.enumOf("jenisPembiayaan", LOAN_KINDS),
      tipeImbalan: x.enumOf("tipeImbalan", RATE_TYPES, true) ?? "BUNGA",
      tarifPersen: x.money("tarifPersen", true) ?? "0.00",
      periode: x.enumOf("periode", PERIODS),
      tenorMaksBulan: x.int("tenorMaksBulan"),
      kodeAkun: x.text("kodeAkun", true) ?? "",
      kodeUnit: x.text("kodeUnit", true) ?? "",
      namaDiSumber: x.text("namaDiSumber", true) ?? ""
    })),
    anggota: rowsOf("Anggota").map(({ t, x }) => ({
      row: t.row,
      noAnggotaLama: x.text("noAnggotaLama", true) ?? "",
      namaLengkap: x.text("namaLengkap", true) ?? "",
      nik: x.text("nik"),
      alamat: x.text("alamat"),
      tempatLahir: x.text("tempatLahir"),
      tanggalLahir: x.date("tanggalLahir"),
      pekerjaan: x.text("pekerjaan"),
      noHp: x.text("noHp"),
      tanggalMasuk: x.date("tanggalMasuk"),
      status: x.enumOf("status", MEMBER_STATUS, true) ?? "AKTIF",
      pengurus: x.yesNo("pengurus"),
      pengawas: x.yesNo("pengawas"),
      kodeUnit: x.text("kodeUnit", true) ?? "",
      catatan: x.text("catatan")
    })),
    simpanan: rowsOf("Simpanan").map(({ t, x }) => ({
      row: t.row,
      noAnggotaLama: x.text("noAnggotaLama", true) ?? "",
      kodeProduk: x.text("kodeProduk", true) ?? "",
      saldo: x.money("saldo", true) ?? "0.00",
      catatan: x.text("catatan")
    })),
    pembiayaan: rowsOf("Pembiayaan").map(({ t, x }) => ({
      row: t.row,
      noAnggotaLama: x.text("noAnggotaLama", true) ?? "",
      kodeProduk: x.text("kodeProduk", true) ?? "",
      noKontrak: x.text("noKontrak"),
      tanggalCair: x.date("tanggalCair"),
      pokokAwal: x.money("pokokAwal"),
      tenorBulan: x.int("tenorBulan"),
      sisaPokok: x.money("sisaPokok", true) ?? "0.00",
      sisaMarginBunga: x.money("sisaMarginBunga"),
      angsuranPokok: x.money("angsuranPokok"),
      angsuranMarginBunga: x.money("angsuranMarginBunga"),
      sisaAngsuranBulan: x.int("sisaAngsuranBulan", true) ?? 0,
      hariTunggakan: x.int("hariTunggakan"),
      kolektibilitas: x.enumOf("kolektibilitas", KOL, true) ?? "LANCAR",
      kodeAkunKhusus: x.text("kodeAkunKhusus"),
      catatan: x.text("catatan")
    })),
    penyesuaian: rowsOf("Penyesuaian").map(({ t, x }) => ({
      row: t.row,
      kodeAkun: x.text("kodeAkun", true) ?? "",
      jumlah: x.money("jumlah", true) ?? "0.00",
      alasan: x.text("alasan", true) ?? "",
      buktiSumber: x.text("buktiSumber"),
      disetujuiOleh: x.text("disetujuiOleh"),
      tanggalPersetujuan: x.date("tanggalPersetujuan")
    }))
  };
  return { payload, issues };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-parser.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Parse the real template once as a smoke check**

```bash
pnpm --filter @siskop/backend exec tsx -e "import {readFileSync} from 'node:fs'; import {parseWorkbook} from './src/modules/migration/parser.ts'; parseWorkbook(readFileSync('../../docs/migration/SISKOP_Template_Migrasi_v1.xlsx')).then(r => console.log(r.payload ? 'payload ok' : 'null', r.issues.map(i => i.code)))"
```

Expected: `payload ok [ 'REQUIRED', ... ]`: the empty template parses structurally; only the empty-info REQUIRED issues appear (namaKoperasi/tanggalCutover are filled with example values in the template, so the list may be empty). A `MISSING_SHEET`/`MISSING_COLUMN` here means the column contract drifted from the template. Fix `columns.ts` or the template, not the parser.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/migration/parser.ts apps/backend/tests/fixtures/migration-workbook.ts apps/backend/tests/migration-parser.test.ts
git commit -m "feat(migration): parse template workbook into typed payload"
```

---

## Task 7: Validation

**Files:**
- Create: `apps/backend/src/modules/migration/validate.ts`
- Test: `apps/backend/tests/migration-validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-validate.test.ts
import { describe, it, expect } from "vitest";
import type { MigrationPayload } from "@siskop/types";
import { parseWorkbook } from "../src/modules/migration/parser.js";
import { validatePayload, type MigrationContext } from "../src/modules/migration/validate.js";
import { buildWorkbook, validSpec, type WorkbookSpec } from "./fixtures/migration-workbook.js";

const CONTEXT: MigrationContext = {
  units: [{ id: "unit-1", name: "Simpan Pinjam" }],
  accounts: [],
  existingMemberCount: 0
};

async function payloadOf(edit: (s: WorkbookSpec) => void = () => {}): Promise<MigrationPayload> {
  const spec = validSpec();
  edit(spec);
  const { payload } = await parseWorkbook(await buildWorkbook(spec));
  if (!payload) throw new Error("fixture did not parse");
  return payload;
}

const codes = (p: MigrationPayload, ctx = CONTEXT) => validatePayload(p, ctx).map((i) => `${i.sheet}:${i.code}`);

describe("validatePayload", () => {
  it("accepts the valid fixture", async () => {
    expect(validatePayload(await payloadOf(), CONTEXT)).toEqual([]);
  });

  it("refuses a tenant that already has members", async () => {
    expect(codes(await payloadOf(), { ...CONTEXT, existingMemberCount: 3 })).toContain("Info_Koperasi:TENANT_NOT_EMPTY");
  });

  it("flags a unit name that does not exist in the tenant", async () => {
    expect(codes(await payloadOf((s) => (s.sheets.Unit[0]!.namaUnit = "Toko")))).toContain("Unit:UNKNOWN_UNIT");
  });

  it("flags duplicate member numbers and invalid or duplicate NIKs", async () => {
    const p = await payloadOf((s) => {
      s.sheets.Anggota.push({ noAnggotaLama: 118, namaLengkap: "Orang Lain", nik: "3578000000000001", status: "AKTIF", kodeUnit: "KSP01" });
      s.sheets.Anggota[1]!.nik = "12345";
    });
    expect(codes(p)).toEqual(expect.arrayContaining(["Anggota:DUPLICATE", "Anggota:INVALID_NIK"]));
    expect(codes(p).filter((c) => c === "Anggota:DUPLICATE")).toHaveLength(2); // number + NIK
  });

  it("flags savings for unknown members, unknown products and negative balances", async () => {
    const p = await payloadOf((s) => {
      s.sheets.Simpanan.push({ noAnggotaLama: 999, kodeProduk: "SPW", saldo: 1 });
      s.sheets.Simpanan.push({ noAnggotaLama: 118, kodeProduk: "MRB", saldo: 1 });
      s.sheets.Simpanan.push({ noAnggotaLama: "226-A", kodeProduk: "SSK", saldo: -5 });
    });
    expect(codes(p)).toEqual(expect.arrayContaining(["Simpanan:UNKNOWN_MEMBER", "Simpanan:UNKNOWN_PRODUCT", "Simpanan:NEGATIVE_BALANCE"]));
  });

  it("flags a duplicate member/product savings row", async () => {
    const p = await payloadOf((s) => s.sheets.Simpanan.push({ noAnggotaLama: 118, kodeProduk: "SPW", saldo: 1 }));
    expect(codes(p)).toContain("Simpanan:DUPLICATE");
  });

  it("warns (not errors) when remaining principal does not match installments", async () => {
    const p = await payloadOf((s) => (s.sheets.Pembiayaan[0]!.sisaPokok = 2_500_000));
    const found = validatePayload(p, CONTEXT).find((i) => i.code === "INSTALLMENT_MISMATCH");
    expect(found?.severity).toBe("WARNING");
  });

  it("flags references to accounts missing from Neraca", async () => {
    const p = await payloadOf((s) => {
      s.sheets.Produk[0]!.kodeAkun = "9-9999";
      s.sheets.Pembiayaan[0]!.kodeAkunKhusus = "1-1150";
    });
    expect(codes(p)).toEqual(expect.arrayContaining(["Produk:UNKNOWN_ACCOUNT", "Pembiayaan:UNKNOWN_ACCOUNT"]));
  });

  it("requires an equity class on EKUITAS accounts and refuses the reserved clearing code", async () => {
    const p = await payloadOf((s) => {
      s.sheets.Neraca[3]!.kelasEkuitas = null;
      s.sheets.Neraca[4]!.kodeAkun = "3-9990";
    });
    expect(codes(p)).toEqual(expect.arrayContaining(["Neraca:REQUIRED", "Neraca:ACCOUNT_CONFLICT"]));
  });

  it("refuses an account code that already exists with a different category", async () => {
    const ctx = { ...CONTEXT, accounts: [{ code: "1-1000", category: "KEWAJIBAN", normalBalance: "KREDIT" }] };
    expect(codes(await payloadOf(), ctx)).toContain("Neraca:ACCOUNT_CONFLICT");
  });

  it("requires every adjustment to name the approving pengurus", async () => {
    const p = await payloadOf((s) => s.sheets.Penyesuaian.push({ kodeAkun: "1-1100", jumlah: 0, alasan: "contoh" }));
    expect(codes(p)).toContain("Penyesuaian:ADJUSTMENT_NOT_APPROVED");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-validate.test.ts`
Expected: FAIL — `validate.js` not found.

- [ ] **Step 3: Create `apps/backend/src/modules/migration/validate.ts`**

```ts
import { Prisma } from "@prisma/client";
import type { MigrationIssue, MigrationNeracaRow, MigrationPayload, MigrationProdukRow } from "@siskop/types";
import { CLEARING_ACCOUNT, INFO_SHEET } from "./columns.js";
import { issue } from "./issues.js";

/** Tenant state the payload is checked against. Loaded by service.ts#loadContext. */
export interface MigrationContext {
  units: Array<{ id: string; name: string }>;
  accounts: Array<{ code: string; category: string; normalBalance: string }>;
  existingMemberCount: number;
}

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validatePayload(p: MigrationPayload, ctx: MigrationContext): MigrationIssue[] {
  const out: MigrationIssue[] = [];
  const tolerance = new Prisma.Decimal(p.info.toleransiSelisih);

  if (ctx.existingMemberCount > 0) {
    out.push(issue(INFO_SHEET, null, null, "TENANT_NOT_EMPTY",
      `Tenant sudah memiliki ${ctx.existingMemberCount} anggota — migrasi saldo awal hanya untuk tenant yang belum berisi data`));
  }

  // Units
  const unitCodes = new Set<string>();
  for (const u of p.units) {
    if (unitCodes.has(u.kodeUnit)) out.push(issue("Unit", u.row, "kodeUnit", "DUPLICATE", `kodeUnit ${u.kodeUnit} ganda`));
    unitCodes.add(u.kodeUnit);
    if (!ctx.units.some((x) => normalizeName(x.name) === normalizeName(u.namaUnit))) {
      out.push(issue("Unit", u.row, "namaUnit", "UNKNOWN_UNIT", `Unit "${u.namaUnit}" belum ada di koperasi ini — buat dulu di Konfigurasi > Unit`));
    }
  }
  const checkUnit = (sheet: string, row: number, code: string | null) => {
    if (code !== null && !unitCodes.has(code)) out.push(issue(sheet, row, "kodeUnit", "UNKNOWN_UNIT", `kodeUnit ${code} tidak ada di sheet Unit`));
  };

  // Neraca
  const accounts = new Map<string, MigrationNeracaRow>();
  for (const a of p.neraca) {
    if (accounts.has(a.kodeAkun)) out.push(issue("Neraca", a.row, "kodeAkun", "DUPLICATE", `kodeAkun ${a.kodeAkun} ganda`));
    accounts.set(a.kodeAkun, a);
    checkUnit("Neraca", a.row, a.kodeUnit);
    if (a.kategori === "EKUITAS" && a.kelasEkuitas === null) {
      out.push(issue("Neraca", a.row, "kelasEkuitas", "REQUIRED", "kelasEkuitas wajib untuk akun EKUITAS"));
    }
    if (a.kodeAkun === CLEARING_ACCOUNT.code) {
      out.push(issue("Neraca", a.row, "kodeAkun", "ACCOUNT_CONFLICT", `${CLEARING_ACCOUNT.code} dicadangkan untuk akun ${CLEARING_ACCOUNT.name}`));
    }
    const existing = ctx.accounts.find((x) => x.code === a.kodeAkun);
    if (existing && (existing.category !== a.kategori || existing.normalBalance !== a.saldoNormal)) {
      out.push(issue("Neraca", a.row, "kodeAkun", "ACCOUNT_CONFLICT",
        `Akun ${a.kodeAkun} sudah ada di koperasi ini sebagai ${existing.category}/${existing.normalBalance}`));
    }
  }
  const checkAccount = (sheet: string, row: number, column: string, code: string) => {
    if (!accounts.has(code)) out.push(issue(sheet, row, column, "UNKNOWN_ACCOUNT", `kodeAkun ${code} tidak ada di sheet Neraca`));
  };

  // Produk
  const products = new Map<string, MigrationProdukRow>();
  for (const pr of p.produk) {
    if (products.has(pr.kodeProduk)) out.push(issue("Produk", pr.row, "kodeProduk", "DUPLICATE", `kodeProduk ${pr.kodeProduk} ganda`));
    products.set(pr.kodeProduk, pr);
    checkAccount("Produk", pr.row, "kodeAkun", pr.kodeAkun);
    checkUnit("Produk", pr.row, pr.kodeUnit);
    if (pr.jenis === "SIMPANAN" && pr.jenisSimpanan === null) {
      out.push(issue("Produk", pr.row, "jenisSimpanan", "REQUIRED", "jenisSimpanan wajib untuk produk SIMPANAN"));
    }
    if (pr.jenis === "PEMBIAYAAN" && pr.jenisPembiayaan === null) {
      out.push(issue("Produk", pr.row, "jenisPembiayaan", "REQUIRED", "jenisPembiayaan wajib untuk produk PEMBIAYAAN"));
    }
  }
  const checkProduct = (sheet: string, row: number, code: string, kind: "SIMPANAN" | "PEMBIAYAAN") => {
    if (products.get(code)?.jenis !== kind) {
      out.push(issue(sheet, row, "kodeProduk", "UNKNOWN_PRODUCT", `kodeProduk ${code} bukan produk ${kind} di sheet Produk`));
    }
  };

  // Anggota
  const members = new Set<string>();
  const niks = new Set<string>();
  for (const m of p.anggota) {
    if (members.has(m.noAnggotaLama)) {
      out.push(issue("Anggota", m.row, "noAnggotaLama", "DUPLICATE",
        `noAnggotaLama ${m.noAnggotaLama} ganda — beri akhiran (mis. ${m.noAnggotaLama}-A / -B) bila dipakai dua orang`));
    }
    members.add(m.noAnggotaLama);
    checkUnit("Anggota", m.row, m.kodeUnit);
    if (m.nik !== null) {
      if (!/^\d{16}$/.test(m.nik)) out.push(issue("Anggota", m.row, "nik", "INVALID_NIK", "NIK harus 16 digit angka — kosongkan bila tidak ada"));
      else if (niks.has(m.nik)) out.push(issue("Anggota", m.row, "nik", "DUPLICATE", `NIK ${m.nik} dipakai lebih dari satu anggota`));
      niks.add(m.nik);
    }
  }
  const checkMember = (sheet: string, row: number, no: string) => {
    if (!members.has(no)) out.push(issue(sheet, row, "noAnggotaLama", "UNKNOWN_MEMBER", `noAnggotaLama ${no} tidak ada di sheet Anggota`));
  };

  // Simpanan
  const pairs = new Set<string>();
  for (const s of p.simpanan) {
    checkMember("Simpanan", s.row, s.noAnggotaLama);
    checkProduct("Simpanan", s.row, s.kodeProduk, "SIMPANAN");
    const key = `${s.noAnggotaLama}|${s.kodeProduk}`;
    if (pairs.has(key)) out.push(issue("Simpanan", s.row, "kodeProduk", "DUPLICATE", `Anggota ${s.noAnggotaLama} punya lebih dari satu baris produk ${s.kodeProduk}`));
    pairs.add(key);
    if (new Prisma.Decimal(s.saldo).isNegative()) out.push(issue("Simpanan", s.row, "saldo", "NEGATIVE_BALANCE", "Saldo simpanan tidak boleh negatif — jelaskan di Penyesuaian"));
  }

  // Pembiayaan
  for (const l of p.pembiayaan) {
    checkMember("Pembiayaan", l.row, l.noAnggotaLama);
    checkProduct("Pembiayaan", l.row, l.kodeProduk, "PEMBIAYAAN");
    if (l.kodeAkunKhusus !== null) checkAccount("Pembiayaan", l.row, "kodeAkunKhusus", l.kodeAkunKhusus);
    const sisa = new Prisma.Decimal(l.sisaPokok);
    if (sisa.isNegative()) out.push(issue("Pembiayaan", l.row, "sisaPokok", "NEGATIVE_BALANCE", "Sisa pokok tidak boleh negatif"));
    if (l.angsuranPokok !== null) {
      const expected = new Prisma.Decimal(l.angsuranPokok).mul(l.sisaAngsuranBulan);
      if (expected.sub(sisa).abs().gt(tolerance)) {
        out.push(issue("Pembiayaan", l.row, "sisaPokok", "INSTALLMENT_MISMATCH",
          `Sisa pokok ${sisa.toFixed(2)} ≠ angsuran pokok × sisa bulan (${expected.toFixed(2)})`, "WARNING"));
      }
    }
  }

  // Penyesuaian
  for (const a of p.penyesuaian) {
    checkAccount("Penyesuaian", a.row, "kodeAkun", a.kodeAkun);
    if (a.disetujuiOleh === null) {
      out.push(issue("Penyesuaian", a.row, "disetujuiOleh", "ADJUSTMENT_NOT_APPROVED", "Penyesuaian belum disetujui pengurus — isi nama & jabatan penyetuju"));
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-validate.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/validate.ts apps/backend/tests/migration-validate.test.ts
git commit -m "feat(migration): row and cross-sheet validation"
```

---

## Task 8: Reconciliation report

**Files:**
- Create: `apps/backend/src/modules/migration/reconcile.ts`
- Test: `apps/backend/tests/migration-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-reconcile.test.ts
import { describe, it, expect } from "vitest";
import type { MigrationPayload } from "@siskop/types";
import { parseWorkbook } from "../src/modules/migration/parser.js";
import { buildReport } from "../src/modules/migration/reconcile.js";
import { buildWorkbook, validSpec, type WorkbookSpec } from "./fixtures/migration-workbook.js";

async function payloadOf(edit: (s: WorkbookSpec) => void = () => {}): Promise<MigrationPayload> {
  const spec = validSpec();
  edit(spec);
  const { payload } = await parseWorkbook(await buildWorkbook(spec));
  if (!payload) throw new Error("fixture did not parse");
  return payload;
}

describe("buildReport", () => {
  it("reconciles the valid fixture account by account", async () => {
    const report = buildReport(await payloadOf(), []);
    expect(report.ready).toBe(true);
    expect(report).toMatchObject({ memberCount: 2, membersWithoutNik: 1, savingRowCount: 3, loanRowCount: 2, totalDebit: "4000000.00", totalKredit: "4000000.00", saldoAwalMigrasi: "0.00" });
    const byCode = Object.fromEntries(report.accounts.map((a) => [a.kodeAkun, a]));
    expect(byCode["1-1000"]).toMatchObject({ status: "TANPA_RINCIAN", selisih: null });
    expect(byCode["1-1100"]).toMatchObject({ status: "COCOK", rincianPembiayaan: "3000000.00", selisih: "0.00" });
    expect(byCode["3-1000"]).toMatchObject({ status: "COCOK", rincianSimpanan: "2000000.00" });
  });

  it("raises RECONCILIATION_MISMATCH when detail and Neraca differ", async () => {
    const report = buildReport(await payloadOf((s) => (s.sheets.Simpanan[0]!.saldo = 1_000_000)), []);
    expect(report.ready).toBe(false);
    expect(report.accounts.find((a) => a.kodeAkun === "3-1000")).toMatchObject({ status: "SELISIH", selisih: "200000.00" });
    expect(report.issues).toContainEqual(expect.objectContaining({ sheet: "Neraca", code: "RECONCILIATION_MISMATCH" }));
  });

  it("closes a known difference through an adjustment row", async () => {
    const report = buildReport(
      await payloadOf((s) => {
        s.sheets.Pembiayaan[0]!.sisaPokok = 2_527_501; // detail larger than Neraca
        s.sheets.Penyesuaian.push({ kodeAkun: "1-1100", jumlah: -527_501, alasan: "Rincian > Neraca", disetujuiOleh: "Bendahara" });
      }),
      []
    );
    expect(report.accounts.find((a) => a.kodeAkun === "1-1100")).toMatchObject({ status: "COCOK", penyesuaian: "-527501.00" });
    expect(report.ready).toBe(true);
  });

  it("accepts a rounding residual within tolerance and refuses one beyond it", async () => {
    const within = buildReport(await payloadOf((s) => (s.sheets.Neraca[0]!.saldo = 1_000_000.33)), []);
    expect(within).toMatchObject({ saldoAwalMigrasi: "0.33", ready: true });
    const beyond = buildReport(await payloadOf((s) => (s.sheets.Neraca[0]!.saldo = 1_000_005)), []);
    expect(beyond.ready).toBe(false);
    expect(beyond.issues).toContainEqual(expect.objectContaining({ code: "UNBALANCED_OPENING" }));
  });

  it("is not ready when validation reported an error, but warnings alone do not block", async () => {
    const p = await payloadOf();
    const error = { severity: "ERROR" as const, sheet: "Anggota", row: 2, column: "nik", code: "INVALID_NIK" as const, message: "x" };
    const warning = { ...error, severity: "WARNING" as const, code: "INSTALLMENT_MISMATCH" as const };
    expect(buildReport(p, [error]).ready).toBe(false);
    expect(buildReport(p, [warning]).ready).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-reconcile.test.ts`
Expected: FAIL — `reconcile.js` not found.

- [ ] **Step 3: Create `apps/backend/src/modules/migration/reconcile.ts`**

```ts
import { Prisma } from "@prisma/client";
import type { MigrationAccountCheck, MigrationIssue, MigrationPayload, MigrationReport } from "@siskop/types";
import { issue } from "./issues.js";

const ZERO = new Prisma.Decimal(0);
const dec = (v: string | null) => new Prisma.Decimal(v ?? 0);

function total<T>(rows: T[], pick: (r: T) => string | null, match: (r: T) => boolean): Prisma.Decimal {
  return rows.filter(match).reduce((sum, r) => sum.add(dec(pick(r))), ZERO);
}

/**
 * Per Neraca account: saldo = Σ member savings + Σ remaining loan principal +
 * Σ named adjustments (within tolerance). An account no product, loan override
 * or adjustment points at has no member-level detail and is reported as
 * TANPA_RINCIAN — its balance is taken from the Neraca as-is. Across the whole
 * Neraca, Σ debit-normal − Σ credit-normal (the residual left on the
 * Saldo Awal Migrasi clearing account) must also be within tolerance.
 */
export function buildReport(p: MigrationPayload, validationIssues: MigrationIssue[]): MigrationReport {
  const issues = [...validationIssues];
  const tolerance = dec(p.info.toleransiSelisih);
  const productAccount = new Map(p.produk.map((x) => [x.kodeProduk, x.kodeAkun]));
  const loanAccount = (l: MigrationPayload["pembiayaan"][number]) => l.kodeAkunKhusus ?? productAccount.get(l.kodeProduk);

  const accounts = p.neraca.map((a): MigrationAccountCheck => {
    const simpanan = total(p.simpanan, (r) => r.saldo, (r) => productAccount.get(r.kodeProduk) === a.kodeAkun);
    const pembiayaan = total(p.pembiayaan, (r) => r.sisaPokok, (r) => loanAccount(r) === a.kodeAkun);
    const penyesuaian = total(p.penyesuaian, (r) => r.jumlah, (r) => r.kodeAkun === a.kodeAkun);
    const base = {
      kodeAkun: a.kodeAkun,
      namaAkun: a.namaAkun,
      saldoNeraca: dec(a.saldo).toFixed(2),
      rincianSimpanan: simpanan.toFixed(2),
      rincianPembiayaan: pembiayaan.toFixed(2),
      penyesuaian: penyesuaian.toFixed(2)
    };
    const backed =
      p.produk.some((x) => x.kodeAkun === a.kodeAkun) ||
      p.pembiayaan.some((x) => x.kodeAkunKhusus === a.kodeAkun) ||
      p.penyesuaian.some((x) => x.kodeAkun === a.kodeAkun);
    if (!backed) return { ...base, selisih: null, status: "TANPA_RINCIAN" };

    const selisih = dec(a.saldo).sub(simpanan).sub(pembiayaan).sub(penyesuaian);
    const matches = selisih.abs().lte(tolerance);
    if (!matches) {
      issues.push(issue("Neraca", a.row, "saldo", "RECONCILIATION_MISMATCH",
        `Akun ${a.kodeAkun} ${a.namaAkun}: saldo Neraca ${base.saldoNeraca} ≠ rincian anggota + penyesuaian (selisih ${selisih.toFixed(2)})`));
    }
    return { ...base, selisih: selisih.toFixed(2), status: matches ? "COCOK" : "SELISIH" };
  });

  const totalDebit = total(p.neraca, (r) => r.saldo, (r) => r.saldoNormal === "DEBIT");
  const totalKredit = total(p.neraca, (r) => r.saldo, (r) => r.saldoNormal === "KREDIT");
  const residual = totalDebit.sub(totalKredit);
  if (p.neraca.length === 0) issues.push(issue("Neraca", null, null, "REQUIRED", "Sheet Neraca kosong"));
  if (residual.abs().gt(tolerance)) {
    issues.push(issue("Neraca", null, null, "UNBALANCED_OPENING",
      `Total debit ${totalDebit.toFixed(2)} ≠ total kredit ${totalKredit.toFixed(2)} (selisih ${residual.toFixed(2)})`));
  }

  return {
    memberCount: p.anggota.length,
    membersWithoutNik: p.anggota.filter((m) => m.nik === null).length,
    savingRowCount: p.simpanan.length,
    loanRowCount: p.pembiayaan.length,
    totalDebit: totalDebit.toFixed(2),
    totalKredit: totalKredit.toFixed(2),
    saldoAwalMigrasi: residual.toFixed(2),
    toleransi: tolerance.toFixed(2),
    accounts,
    issues,
    ready: !issues.some((i) => i.severity === "ERROR")
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-reconcile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/reconcile.ts apps/backend/tests/migration-reconcile.test.ts
git commit -m "feat(migration): reconciliation report against the opening Neraca"
```

---

## Task 9: Opening-balance journal posting and in-transaction member IDs

**Files:**
- Modify: `apps/backend/src/lib/journal.ts`, `apps/backend/src/lib/id-generator.ts`
- Test: `apps/backend/tests/migration-journal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-journal.test.ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../src/lib/db.js";
import { postOpeningBalance } from "../src/lib/journal.js";
import { memberIdAllocator } from "../src/lib/id-generator.js";
import { setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function twoAccounts(tenantId: string) {
  const kas = await db.account.create({ data: { tenantId, code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" } });
  const cadangan = await db.account.create({ data: { tenantId, code: "3-2000", name: "Cadangan", category: "EKUITAS", normalBalance: "KREDIT", equityClass: "CADANGAN_UMUM" } });
  return { kas, cadangan };
}

describe("postOpeningBalance", () => {
  it("posts one OPENING_BALANCE entry dated at the cutover", async () => {
    const { user } = await setupTenant();
    const { kas, cadangan } = await twoAccounts(user.tenantId);
    await db.$transaction((tx) =>
      postOpeningBalance(tx, {
        tenantId: user.tenantId,
        unitId: null,
        batchId: "batch-1",
        entryDate: new Date("2025-12-31T00:00:00Z"),
        description: "Saldo awal migrasi",
        lines: [
          { accountId: kas.id, debit: 500_000 },
          { accountId: cadangan.id, credit: 500_000 }
        ]
      })
    );
    const entry = await db.journalEntry.findFirstOrThrow({ where: { tenantId: user.tenantId }, include: { lines: true } });
    expect(entry).toMatchObject({ sourceType: "OPENING_BALANCE", sourceId: "batch-1", status: "POSTED" });
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(entry.lines).toHaveLength(2);
  });

  it("refuses an unbalanced entry", async () => {
    const { user } = await setupTenant();
    const { kas, cadangan } = await twoAccounts(user.tenantId);
    await expect(
      db.$transaction((tx) =>
        postOpeningBalance(tx, {
          tenantId: user.tenantId, unitId: null, batchId: "b", entryDate: new Date("2025-12-31T00:00:00Z"), description: "x",
          lines: [{ accountId: kas.id, debit: 500_000 }, { accountId: cadangan.id, credit: 400_000 }]
        })
      )
    ).rejects.toThrow(/JOURNAL_ENTRY_UNBALANCED/);
  });
});

describe("memberIdAllocator", () => {
  it("hands out consecutive member ids inside one transaction", async () => {
    const { user } = await setupTenant();
    const ids = await db.$transaction(async (tx) => {
      const next = await memberIdAllocator(tx, user.tenantId, "demo");
      return [next(), next(), next()];
    });
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toMatch(/^KOP-DEMO-\d{6}-0001$/);
    expect(ids[2]).toMatch(/-0003$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-journal.test.ts`
Expected: FAIL — `postOpeningBalance` / `memberIdAllocator` not exported.

- [ ] **Step 3: Implement in `apps/backend/src/lib/journal.ts`**

Export the line type (change `interface JournalLineInput` to):

```ts
export interface JournalLineInput {
```

Add `"OPENING_BALANCE"` to the `sourceType` union in `createJournalEntry`'s params:

```ts
    sourceType:
      | "SAVING_TRANSACTION"
      | "LOAN_PAYMENT"
      | "LOAN_DISBURSEMENT"
      | "POS_SALE"
      | "MEMBER_CREDIT_REPAYMENT"
      | "STOCK_MOVEMENT"
      | "OPENING_BALANCE";
```

Add after `postLoanDisbursement`:

```ts
/**
 * Opening balances from a committed MigrationBatch (modules/migration/commit.ts).
 * Unlike the other posters, the lines are built by the caller from the migrated
 * Neraca — there is no AccountMapping to resolve — and must already balance
 * against the Saldo Awal Migrasi clearing account.
 */
export async function postOpeningBalance(
  tx: TxClient,
  params: {
    tenantId: string;
    unitId: string | null;
    batchId: string;
    entryDate: Date;
    description: string;
    lines: JournalLineInput[];
  }
): Promise<void> {
  if (params.lines.length === 0) return;
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "OPENING_BALANCE",
    sourceId: params.batchId,
    description: params.description,
    lines: params.lines
  });
}
```

- [ ] **Step 4: Implement in `apps/backend/src/lib/id-generator.ts`**

Add the import at the top: `import type { TxClient } from "./db.js";` and append:

```ts
/**
 * generateMemberId() counts committed rows on the global client, so inside a
 * transaction that creates many members it would hand out the same id each
 * time. This reads the starting count once through `tx` and increments in
 * memory — only for bulk creation within a single transaction (migration commit).
 */
export async function memberIdAllocator(tx: TxClient, tenantId: string, tenantSlug: string): Promise<() => string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `KOP-${tenantSlug.toUpperCase()}-${yearMonth}-`;
  let sequence = await tx.member.count({ where: { tenantId, memberId: { startsWith: prefix } } });
  return () => `${prefix}${String(++sequence).padStart(4, "0")}`;
}
```

- [ ] **Step 5: Run the test, then the journal suites to confirm nothing regressed**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-journal.test.ts tests/journal-unit.test.ts tests/stock-journal.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/journal.ts apps/backend/src/lib/id-generator.ts apps/backend/tests/migration-journal.test.ts
git commit -m "feat(journal): opening-balance posting and in-transaction member id allocation"
```

---

## Task 10: Draft batch service (upload, current, discard)

**Files:**
- Create: `apps/backend/src/modules/migration/service.ts` (draft part), `apps/backend/src/modules/migration/commit.ts` (stub export, completed in Task 11)
- Test: `apps/backend/tests/migration-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-service.test.ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../src/lib/db.js";
import { createDraftBatch, discardBatch, getCurrentBatch } from "../src/modules/migration/service.js";
import { setupTenant, createMemberAs } from "./helpers.js";
import { buildWorkbook, validSpec } from "./fixtures/migration-workbook.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const STAFF = { id: "platform-user-1", name: "Tim Onboarding" };
const file = async () => ({ buffer: await buildWorkbook(validSpec()), originalname: "migrasi-v1.xlsx" });

describe("createDraftBatch", () => {
  it("stores a DRAFT batch with a ready report", async () => {
    const { user } = await setupTenant();
    const batch = await createDraftBatch(user.tenantId, await file(), STAFF);
    expect(batch).toMatchObject({ status: "DRAFT", version: 1, sourceFileName: "migrasi-v1.xlsx", cutoverDate: "2025-12-31", uploadedByName: "Tim Onboarding" });
    expect(batch.report.ready).toBe(true);
    expect(await db.member.count({ where: { tenantId: user.tenantId } })).toBe(0);
  });

  it("stores a not-ready draft so staff can see the issues", async () => {
    const { user } = await setupTenant();
    const spec = validSpec();
    spec.sheets.Simpanan[0]!.saldo = 1;
    const batch = await createDraftBatch(user.tenantId, { buffer: await buildWorkbook(spec), originalname: "x.xlsx" }, STAFF);
    expect(batch.report.ready).toBe(false);
    expect(batch.report.issues.map((i) => i.code)).toContain("RECONCILIATION_MISMATCH");
  });

  it("rejects a structurally broken file without storing anything", async () => {
    const { user } = await setupTenant();
    await expect(createDraftBatch(user.tenantId, { buffer: await buildWorkbook(validSpec(), { omitSheet: "Neraca" }), originalname: "x.xlsx" }, STAFF))
      .rejects.toThrow(/VALIDATION_ERROR/);
    expect(await db.migrationBatch.count({ where: { tenantId: user.tenantId } })).toBe(0);
  });

  it("discards the previous draft when a new version is uploaded", async () => {
    const { user } = await setupTenant();
    const v1 = await createDraftBatch(user.tenantId, await file(), STAFF);
    const v2 = await createDraftBatch(user.tenantId, await file(), STAFF);
    expect(v2.version).toBe(2);
    const old = await db.migrationBatch.findFirstOrThrow({ where: { id: v1.id, tenantId: user.tenantId } });
    expect(old.status).toBe("DISCARDED");
    expect((await getCurrentBatch(user.tenantId))?.id).toBe(v2.id);
  });

  it("reports TENANT_NOT_EMPTY for a tenant that already has members", async () => {
    const admin = await setupTenant();
    await createMemberAs(admin.accessToken);
    const batch = await createDraftBatch(admin.user.tenantId, await file(), STAFF);
    expect(batch.report.issues.map((i) => i.code)).toContain("TENANT_NOT_EMPTY");
  });

  it("404s for an unknown tenant", async () => {
    await expect(createDraftBatch("no-such-tenant", await file(), STAFF)).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("discardBatch", () => {
  it("discards a draft and leaves no current batch", async () => {
    const { user } = await setupTenant();
    const batch = await createDraftBatch(user.tenantId, await file(), STAFF);
    await discardBatch(user.tenantId, batch.id);
    expect(await getCurrentBatch(user.tenantId)).toBeNull();
  });

  it("cannot reach another tenant's batch", async () => {
    const a = await setupTenant();
    const b = await setupTenant({ slug: "kedua", registrationNo: "KOP-2", adminEmail: "admin@kedua.test" });
    const batch = await createDraftBatch(a.user.tenantId, await file(), STAFF);
    await expect(discardBatch(b.user.tenantId, batch.id)).rejects.toThrow(/NOT_FOUND/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-service.test.ts`
Expected: FAIL — `service.js` not found.

- [ ] **Step 3: Create `apps/backend/src/modules/migration/service.ts`**

```ts
import { Prisma, type MigrationBatch } from "@prisma/client";
import { ErrorCode, type MigrationBatchSummary, type MigrationPayload, type MigrationReport } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { parseWorkbook } from "./parser.js";
import { validatePayload, type MigrationContext } from "./validate.js";
import { buildReport } from "./reconcile.js";

export interface Actor {
  id: string;
  name: string;
}

const toJson = (v: unknown) => v as Prisma.InputJsonValue;

export async function loadContext(tenantId: string): Promise<MigrationContext> {
  const [units, accounts, existingMemberCount] = await Promise.all([
    db.cooperativeUnit.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    db.account.findMany({ where: { tenantId }, select: { code: true, category: true, normalBalance: true } }),
    db.member.count({ where: { tenantId } })
  ]);
  return { units, accounts, existingMemberCount };
}

export function analyse(payload: MigrationPayload, ctx: MigrationContext): MigrationReport {
  return buildReport(payload, validatePayload(payload, ctx));
}

export function toSummary(b: MigrationBatch): MigrationBatchSummary {
  return {
    id: b.id,
    status: b.status,
    version: b.version,
    sourceFileName: b.sourceFileName,
    cutoverDate: b.cutoverDate ? b.cutoverDate.toISOString().slice(0, 10) : null,
    report: b.report as unknown as MigrationReport,
    uploadedByName: b.uploadedByName,
    createdAt: b.createdAt.toISOString(),
    committedByName: b.committedByName,
    committedAt: b.committedAt ? b.committedAt.toISOString() : null,
    beritaAcaraUrl: b.beritaAcaraUrl
  };
}

/**
 * Platform-staff upload. tenantId comes from the platform route's URL — the
 * one sanctioned exception to CLAUDE.md rule 1 for this module — and this
 * function only ever writes MigrationBatch rows, never live tenant data.
 */
export async function createDraftBatch(
  tenantId: string,
  file: { buffer: Buffer; originalname: string },
  uploader: Actor
): Promise<MigrationBatchSummary> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw notFound("Koperasi tidak ditemukan");
  if (await db.migrationBatch.findFirst({ where: { tenantId, status: "COMMITTED" } })) {
    throw conflict("Migrasi saldo awal koperasi ini sudah diposting");
  }

  const { payload, issues } = await parseWorkbook(file.buffer);
  if (!payload) throw new AppError(ErrorCode.VALIDATION_ERROR, "Berkas tidak sesuai template migrasi", { issues });
  const report = analyse(payload, await loadContext(tenantId));

  const batch = await db.$transaction(async (tx) => {
    await tx.migrationBatch.updateMany({ where: { tenantId, status: "DRAFT" }, data: { status: "DISCARDED" } });
    const version = (await tx.migrationBatch.count({ where: { tenantId } })) + 1;
    return tx.migrationBatch.create({
      data: {
        tenantId,
        version,
        sourceFileName: file.originalname,
        cutoverDate: payload.info.tanggalCutover ? new Date(`${payload.info.tanggalCutover}T00:00:00Z`) : null,
        payload: toJson(payload),
        report: toJson(report),
        uploadedById: uploader.id,
        uploadedByName: uploader.name
      }
    });
  });
  return toSummary(batch);
}

/** The latest DRAFT or COMMITTED batch, or null. */
export async function getCurrentBatch(tenantId: string): Promise<MigrationBatchSummary | null> {
  const batch = await db.migrationBatch.findFirst({
    where: { tenantId, status: { in: ["DRAFT", "COMMITTED"] } },
    orderBy: { createdAt: "desc" }
  });
  return batch ? toSummary(batch) : null;
}

export async function discardBatch(tenantId: string, batchId: string): Promise<MigrationBatchSummary> {
  const batch = await db.migrationBatch.findFirst({ where: { id: batchId, tenantId } });
  if (!batch) throw notFound("Batch migrasi tidak ditemukan");
  if (batch.status !== "DRAFT") throw conflict("Hanya batch berstatus DRAFT yang bisa dibuang");
  const updated = await db.migrationBatch.update({ where: { id: batchId, tenantId }, data: { status: "DISCARDED" } });
  return toSummary(updated);
}
```

(`conflict` already exists in `lib/errors.ts` — it is imported by `lib/journal.ts`. If `notFound`/`conflict` are named differently there, use the existing names.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-service.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/migration/service.ts apps/backend/tests/migration-service.test.ts
git commit -m "feat(migration): draft batch upload, current and discard"
```

---

## Task 11: Commit a batch

**Files:**
- Create: `apps/backend/src/modules/migration/commit.ts`
- Modify: `apps/backend/src/modules/migration/service.ts` (add `commitBatch`)
- Test: `apps/backend/tests/migration-commit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/migration-commit.test.ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../src/lib/db.js";
import { commitBatch, createDraftBatch } from "../src/modules/migration/service.js";
import { setupTenant } from "./helpers.js";
import { buildWorkbook, validSpec, type WorkbookSpec } from "./fixtures/migration-workbook.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const STAFF = { id: "platform-user-1", name: "Tim Onboarding" };
const URL = "/uploads/migration/x/berita-acara.pdf";

async function draft(tenantId: string, edit: (s: WorkbookSpec) => void = () => {}) {
  const spec = validSpec();
  edit(spec);
  return createDraftBatch(tenantId, { buffer: await buildWorkbook(spec), originalname: "m.xlsx" }, STAFF);
}

describe("commitBatch", () => {
  it("creates members, savings, loans and a balanced opening journal", async () => {
    const { user } = await setupTenant();
    const batch = await draft(user.tenantId);
    const approver = { id: user.id, name: "Ketua" };

    const result = await commitBatch(user.tenantId, batch.id, approver, URL);
    expect(result).toMatchObject({ status: "COMMITTED", committedByName: "Ketua", beritaAcaraUrl: URL });

    const members = await db.member.findMany({ where: { tenantId: user.tenantId }, orderBy: { legacyMemberNo: "asc" } });
    expect(members.map((m) => [m.legacyMemberNo, m.nik, m.isPengurus])).toEqual([
      ["118", "3578000000000001", true],
      ["226-A", null, false]
    ]);
    expect(new Set(members.map((m) => m.memberId)).size).toBe(2);
    expect(await db.unitMembership.count({ where: { memberId: { in: members.map((m) => m.id) } } })).toBe(2);

    const savings = await db.saving.findMany({ where: { tenantId: user.tenantId }, include: { transactions: true, savingConfig: true } });
    expect(savings).toHaveLength(3);
    const ssk = savings.find((s) => s.savingConfig.name === "Tabungan Sukarela")!;
    expect(ssk.balance.toFixed(2)).toBe("1500000.00");
    expect(ssk.transactions).toEqual([expect.objectContaining({ type: "OPENING_BALANCE", createdBy: user.id })]);
    expect(ssk.transactions[0]!.createdAt.toISOString().slice(0, 10)).toBe("2025-12-31");

    const loans = await db.loan.findMany({ where: { tenantId: user.tenantId }, orderBy: { principalAmount: "desc" } });
    expect(loans.map((l) => [l.principalAmount.toFixed(2), l.remainingAmount.toFixed(2), l.termMonths, l.monthlyPayment.toFixed(2), l.kolCategory])).toEqual([
      ["2000000.00", "2400000.00", 10, "240000.00", "LANCAR"],
      ["1000000.00", "1000000.00", 10, "100000.00", "DALAM_PERHATIAN"]
    ]);

    const entries = await db.journalEntry.findMany({ where: { tenantId: user.tenantId }, include: { lines: { include: { account: true } } } });
    expect(entries.every((e) => e.sourceType === "OPENING_BALANCE" && e.sourceId === batch.id)).toBe(true);
    const lines = entries.flatMap((e) => e.lines);
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit).toBe(credit);
    const balanceOf = (code: string) =>
      lines.filter((l) => l.account.code === code).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(balanceOf("1-1100")).toBe(3_000_000);
    expect(balanceOf("3-1000")).toBe(-2_000_000);
    // Cadangan sits in the unallocated bucket (kodeUnit blank); the unit and
    // tenant buckets each balance through the clearing account, which nets to 0.
    expect(entries.some((e) => e.unitId === null)).toBe(true);
    expect(balanceOf("3-9990")).toBe(0);
  });

  it("leaves the rounding residual on the clearing account", async () => {
    const { user } = await setupTenant();
    const batch = await draft(user.tenantId, (s) => (s.sheets.Neraca[0]!.saldo = 1_000_000.33));
    await commitBatch(user.tenantId, batch.id, { id: user.id, name: "Ketua" }, URL);
    const clearing = await db.journalLine.findMany({ where: { tenantId: user.tenantId, account: { code: "3-9990" } } });
    const net = clearing.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    expect(net.toFixed(2)).toBe("0.33");
  });

  it("refuses a batch that is not ready and writes nothing", async () => {
    const { user } = await setupTenant();
    const batch = await draft(user.tenantId, (s) => (s.sheets.Simpanan[0]!.saldo = 1));
    await expect(commitBatch(user.tenantId, batch.id, { id: user.id, name: "Ketua" }, URL)).rejects.toThrow(/VALIDATION_ERROR/);
    expect(await db.member.count({ where: { tenantId: user.tenantId } })).toBe(0);
  });

  it("cannot commit the same batch twice", async () => {
    const { user } = await setupTenant();
    const batch = await draft(user.tenantId);
    await commitBatch(user.tenantId, batch.id, { id: user.id, name: "Ketua" }, URL);
    await expect(commitBatch(user.tenantId, batch.id, { id: user.id, name: "Ketua" }, URL)).rejects.toThrow(/CONFLICT/);
    expect(await db.member.count({ where: { tenantId: user.tenantId } })).toBe(2);
  });

  it("reuses an existing account with a matching category instead of duplicating it", async () => {
    const { user } = await setupTenant();
    await db.account.create({ data: { tenantId: user.tenantId, code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true } });
    const batch = await draft(user.tenantId);
    await commitBatch(user.tenantId, batch.id, { id: user.id, name: "Ketua" }, URL);
    expect(await db.account.count({ where: { tenantId: user.tenantId, code: "1-1000" } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-commit.test.ts`
Expected: FAIL — `commitBatch` is not exported.

- [ ] **Step 3: Create `apps/backend/src/modules/migration/commit.ts`**

```ts
import { Prisma, type EquityClass } from "@prisma/client";
import type { MigrationPayload } from "@siskop/types";
import type { TxClient } from "../../lib/db.js";
import { generateAccountNumber, memberIdAllocator } from "../../lib/id-generator.js";
import { postOpeningBalance, type JournalLineInput } from "../../lib/journal.js";
import { CLEARING_ACCOUNT } from "./columns.js";

export interface CommitArgs {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
  payload: MigrationPayload;
  /** kodeUnit → CooperativeUnit.id, resolved and validated by the caller. */
  units: Map<string, string>;
  committedById: string;
}

const dec = (v: string | null) => new Prisma.Decimal(v ?? 0);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Migration commit: unresolved ${what}`);
  return value;
}

async function uniqueAccountNumber(used: Set<string>): Promise<string> {
  let n: string;
  do n = await generateAccountNumber();
  while (used.has(n));
  used.add(n);
  return n;
}

/**
 * Writes a validated, reconciled payload into live tables. Runs inside the
 * caller's transaction; any throw rolls the whole batch back. Member savings
 * and loans are sub-ledger rows only — the general ledger comes from the
 * Neraca sheet, one OPENING_BALANCE entry per unit bucket, each balanced
 * against the Saldo Awal Migrasi clearing account.
 */
export async function commitPayload(tx: TxClient, a: CommitArgs): Promise<void> {
  const { tenantId, batchId, payload: p } = a;
  const cutover = dateOf(p.info.tanggalCutover);
  const unitOf = (code: string) => must(a.units.get(code), `unit ${code}`);

  // 1. Accounts (reuse by code; validation already refused category conflicts)
  const accountIds = new Map<string, string>();
  for (const row of p.neraca) {
    const existing = await tx.account.findFirst({ where: { tenantId, code: row.kodeAkun } });
    const account =
      existing ??
      (await tx.account.create({
        data: {
          tenantId,
          code: row.kodeAkun,
          name: row.namaAkun,
          category: row.kategori,
          normalBalance: row.saldoNormal,
          equityClass: row.kategori === "EKUITAS" ? (row.kelasEkuitas as EquityClass) : null,
          isActive: true
        }
      }));
    accountIds.set(row.kodeAkun, account.id);
  }
  const clearing =
    (await tx.account.findFirst({ where: { tenantId, code: CLEARING_ACCOUNT.code } })) ??
    (await tx.account.create({ data: { tenantId, ...CLEARING_ACCOUNT, isActive: true } }));

  // 2. Products
  const savingConfigIds = new Map<string, string>();
  const loanConfigIds = new Map<string, string>();
  for (const pr of p.produk) {
    if (pr.jenis === "SIMPANAN") {
      const config = await tx.savingConfig.create({
        data: {
          tenantId,
          name: pr.namaProduk,
          type: pr.jenisSimpanan ?? "SUKARELA",
          rateType: pr.tipeImbalan,
          rate: pr.tarifPersen,
          periodUnit: pr.periode ?? "MONTHLY",
          isActive: true
        }
      });
      savingConfigIds.set(pr.kodeProduk, config.id);
    } else {
      const longest = Math.max(12, ...p.pembiayaan.filter((l) => l.kodeProduk === pr.kodeProduk).map((l) => l.sisaAngsuranBulan));
      const config = await tx.loanConfig.create({
        data: {
          tenantId,
          name: pr.namaProduk,
          type: pr.jenisPembiayaan ?? "KONVENSIONAL",
          rateType: pr.tipeImbalan,
          rate: pr.tarifPersen,
          maxTermMonths: pr.tenorMaksBulan ?? longest,
          isActive: true
        }
      });
      loanConfigIds.set(pr.kodeProduk, config.id);
    }
  }
  const productUnit = new Map(p.produk.map((pr) => [pr.kodeProduk, unitOf(pr.kodeUnit)]));

  // 3. Members
  const nextMemberId = await memberIdAllocator(tx, tenantId, a.tenantSlug);
  const usedAccountNumbers = new Set<string>();
  const memberIds = new Map<string, string>();
  for (const m of p.anggota) {
    const member = await tx.member.create({
      data: {
        tenantId,
        memberId: nextMemberId(),
        accountNumber: await uniqueAccountNumber(usedAccountNumbers),
        legacyMemberNo: m.noAnggotaLama,
        migrationBatchId: batchId,
        fullName: m.namaLengkap,
        nik: m.nik,
        address: m.alamat ?? "",
        birthPlace: m.tempatLahir ?? "",
        birthDate: m.tanggalLahir ? dateOf(m.tanggalLahir) : null,
        occupation: m.pekerjaan ?? "",
        isActive: m.status === "AKTIF",
        isPengurus: m.pengurus,
        isPengawas: m.pengawas
      }
    });
    await tx.unitMembership.create({ data: { memberId: member.id, unitId: unitOf(m.kodeUnit) } });
    memberIds.set(m.noAnggotaLama, member.id);
  }

  // 4. Savings (sub-ledger) — balance plus one dated OPENING_BALANCE row for the statement
  for (const s of p.simpanan) {
    const saving = await tx.saving.create({
      data: {
        tenantId,
        unitId: must(productUnit.get(s.kodeProduk), `product unit ${s.kodeProduk}`),
        memberId: must(memberIds.get(s.noAnggotaLama), `member ${s.noAnggotaLama}`),
        savingConfigId: must(savingConfigIds.get(s.kodeProduk), `saving config ${s.kodeProduk}`),
        balance: s.saldo,
        isActive: true,
        migrationBatchId: batchId
      }
    });
    if (dec(s.saldo).gt(0)) {
      await tx.savingTransaction.create({
        data: { savingId: saving.id, tenantId, type: "OPENING_BALANCE", amount: s.saldo, note: "Saldo awal migrasi", createdBy: a.committedById, createdAt: cutover }
      });
    }
  }

  // 5. Loans (sub-ledger) — remaining state as of the cutover
  for (const l of p.pembiayaan) {
    const total = dec(l.sisaPokok).add(dec(l.sisaMarginBunga));
    const months = Math.max(l.sisaAngsuranBulan, 1);
    const installment =
      l.angsuranPokok !== null ? dec(l.angsuranPokok).add(dec(l.angsuranMarginBunga)) : total.div(months).toDecimalPlaces(2);
    await tx.loan.create({
      data: {
        tenantId,
        unitId: must(productUnit.get(l.kodeProduk), `product unit ${l.kodeProduk}`),
        memberId: must(memberIds.get(l.noAnggotaLama), `member ${l.noAnggotaLama}`),
        loanConfigId: must(loanConfigIds.get(l.kodeProduk), `loan config ${l.kodeProduk}`),
        principalAmount: l.sisaPokok,
        totalAmount: total,
        termMonths: months,
        monthlyPayment: installment,
        remainingAmount: total,
        status: "ACTIVE",
        kolCategory: l.kolektibilitas,
        daysOverdue: l.hariTunggakan ?? 0,
        disbursedAt: l.tanggalCair ? dateOf(l.tanggalCair) : cutover,
        migrationBatchId: batchId
      }
    });
  }

  // 6. General ledger — one entry per unit bucket (null = unallocated), balanced by the clearing account
  const buckets = new Map<string | null, JournalLineInput[]>();
  for (const row of p.neraca) {
    const amount = dec(row.saldo);
    if (amount.isZero()) continue;
    const accountId = must(accountIds.get(row.kodeAkun), `account ${row.kodeAkun}`);
    const onDebitSide = (row.saldoNormal === "DEBIT") === amount.gt(0);
    const line: JournalLineInput = onDebitSide ? { accountId, debit: amount.abs() } : { accountId, credit: amount.abs() };
    const key = row.kodeUnit ? unitOf(row.kodeUnit) : null;
    buckets.set(key, [...(buckets.get(key) ?? []), line]);
  }
  for (const [unitId, lines] of buckets) {
    const net = lines.reduce((s, l) => s.add(l.debit ?? 0).sub(l.credit ?? 0), new Prisma.Decimal(0));
    if (!net.isZero()) lines.push(net.gt(0) ? { accountId: clearing.id, credit: net } : { accountId: clearing.id, debit: net.abs() });
    await postOpeningBalance(tx, {
      tenantId,
      unitId,
      batchId,
      entryDate: cutover,
      description: `Saldo awal migrasi per ${p.info.tanggalCutover}`,
      lines
    });
  }
}
```

- [ ] **Step 4: Add `commitBatch` to `apps/backend/src/modules/migration/service.ts`**

Add imports: `import { commitPayload } from "./commit.js";` and `normalizeName` to the `./validate.js` import. Append:

```ts
/**
 * Tenant approval. tenantId comes from req.auth only (routes.ts). Re-runs
 * validation and reconciliation against the tenant's *current* state rather
 * than trusting the stored report, then claims the batch with a conditional
 * update so two concurrent approvals cannot both post.
 */
export async function commitBatch(
  tenantId: string,
  batchId: string,
  approver: Actor,
  beritaAcaraUrl: string
): Promise<MigrationBatchSummary> {
  const batch = await db.migrationBatch.findFirst({ where: { id: batchId, tenantId } });
  if (!batch) throw notFound("Batch migrasi tidak ditemukan");
  if (batch.status !== "DRAFT") throw conflict("Batch migrasi ini sudah diproses");

  const payload = batch.payload as unknown as MigrationPayload;
  const ctx = await loadContext(tenantId);
  const report = analyse(payload, ctx);
  if (!report.ready) throw new AppError(ErrorCode.VALIDATION_ERROR, "Batch migrasi belum siap diposting", { report });

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
  const units = new Map<string, string>();
  for (const u of payload.units) {
    const match = ctx.units.find((x) => normalizeName(x.name) === normalizeName(u.namaUnit));
    if (match) units.set(u.kodeUnit, match.id);
  }

  const committed = await db.$transaction(
    async (tx) => {
      const claimed = await tx.migrationBatch.updateMany({
        where: { id: batchId, tenantId, status: "DRAFT" },
        data: {
          status: "COMMITTED",
          committedById: approver.id,
          committedByName: approver.name,
          committedAt: new Date(),
          beritaAcaraUrl,
          report: toJson(report)
        }
      });
      if (claimed.count !== 1) throw conflict("Batch migrasi ini sudah diproses");
      await commitPayload(tx, { tenantId, tenantSlug: tenant.slug, batchId, payload, units, committedById: approver.id });
      return tx.migrationBatch.findFirstOrThrow({ where: { id: batchId, tenantId } });
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  return toSummary(committed);
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @siskop/backend exec vitest run tests/migration-commit.test.ts`
Expected: PASS (5 tests). If the extended Prisma client rejects the options object on `$transaction`, check `lib/db.ts` for how other long transactions pass options and match it.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/migration/commit.ts apps/backend/src/modules/migration/service.ts apps/backend/tests/migration-commit.test.ts
git commit -m "feat(migration): commit batch into members, savings, loans and opening journal"
```

---

## Task 12: Upload helpers and HTTP routes

**Files:**
- Modify: `apps/backend/src/lib/file-sniff.ts`, `apps/backend/src/modules/platform/routes.ts`, `apps/backend/src/app.ts`
- Create: `apps/backend/src/modules/migration/upload.ts`, `platform.routes.ts`, `routes.ts`
- Test: `apps/backend/tests/file-sniff.test.ts` (append), `apps/backend/tests/migration-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/file-sniff.test.ts`:

```ts
it("recognises an xlsx (zip) container", () => {
  expect(sniffFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe("zip");
});
```

Create `apps/backend/tests/migration-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, createStaffSession, setupTenant } from "./helpers.js";
import { buildWorkbook, validSpec } from "./fixtures/migration-workbook.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.STORAGE_PATH = "./tmp-test-uploads";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const PDF = Buffer.from("%PDF-1.4\n%berita acara\n");

/** The client koperasi. Not the default "demo" slug: createPlatformAdminSession() provisions that one. */
const clientTenant = () => setupTenant({ slug: "klien", registrationNo: "KOP-K", adminEmail: "admin@klien.test" });

async function uploadAsPlatform(tenantId: string) {
  const platform = await createPlatformAdminSession();
  return request(app())
    .post(`/api/platform/tenants/${tenantId}/migrations`)
    .set("Authorization", `Bearer ${platform.accessToken}`)
    .attach("file", await buildWorkbook(validSpec()), "migrasi.xlsx");
}

describe("platform migration routes", () => {
  it("lets a platform admin upload a draft into a tenant", async () => {
    const platform = await createPlatformAdminSession();
    const client = await setupTenant({ slug: "klien", registrationNo: "KOP-K", adminEmail: "admin@klien.test" });
    const res = await request(app())
      .post(`/api/platform/tenants/${client.user.tenantId}/migrations`)
      .set("Authorization", `Bearer ${platform.accessToken}`)
      .attach("file", await buildWorkbook(validSpec()), "migrasi.xlsx");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "DRAFT", version: 1, report: { ready: true } });
  });

  it("refuses a tenant admin on the platform route", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post(`/api/platform/tenants/${admin.user.tenantId}/migrations`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .attach("file", await buildWorkbook(validSpec()), "migrasi.xlsx");
    expect(res.status).toBe(403);
  });

  it("rejects a non-xlsx upload", async () => {
    const platform = await createPlatformAdminSession();
    const res = await request(app())
      .post(`/api/platform/tenants/${platform.user.tenantId}/migrations`)
      .set("Authorization", `Bearer ${platform.accessToken}`)
      .attach("file", PDF, "migrasi.xlsx");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
  });

  it("has no commit endpoint for platform staff", async () => {
    const platform = await createPlatformAdminSession();
    const res = await request(app())
      .post(`/api/platform/tenants/${platform.user.tenantId}/migrations/any/commit`)
      .set("Authorization", `Bearer ${platform.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe("tenant migration routes", () => {
  it("shows the current draft to a user with migration.read", async () => {
    const admin = await clientTenant();
    await uploadAsPlatform(admin.user.tenantId);
    const res = await request(app()).get("/api/migration/current").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DRAFT");
  });

  it("commits with a berita acara PDF", async () => {
    const admin = await clientTenant();
    const draft = (await uploadAsPlatform(admin.user.tenantId)).body.data;
    const res = await request(app())
      .post(`/api/migration/${draft.id}/commit`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .attach("beritaAcara", PDF, "berita-acara.pdf");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMMITTED");
    expect(res.body.data.beritaAcaraUrl).toMatch(/^\/uploads\/migration\//);
    expect(await db.member.count({ where: { tenantId: admin.user.tenantId } })).toBe(2);
  });

  it("requires the berita acara", async () => {
    const admin = await clientTenant();
    const draft = (await uploadAsPlatform(admin.user.tenantId)).body.data;
    const res = await request(app()).post(`/api/migration/${draft.id}/commit`).set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(422);
  });

  it("refuses approval without migration.update", async () => {
    const admin = await clientTenant();
    const draft = (await uploadAsPlatform(admin.user.tenantId)).body.data;
    const teller = await createStaffSession(admin.user.tenantId, "klien", "Teller", "teller@klien.test");
    const res = await request(app())
      .post(`/api/migration/${draft.id}/commit`)
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .attach("beritaAcara", PDF, "berita-acara.pdf");
    expect(res.status).toBe(403);
  });

  it("cannot commit another tenant's batch", async () => {
    const a = await clientTenant();
    const b = await setupTenant({ slug: "kedua", registrationNo: "KOP-2", adminEmail: "admin@kedua.test" });
    const draft = (await uploadAsPlatform(a.user.tenantId)).body.data;
    const res = await request(app())
      .post(`/api/migration/${draft.id}/commit`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .attach("beritaAcara", PDF, "berita-acara.pdf");
    expect(res.status).toBe(404);
  });
});
```

Note: `createPlatformAdminSession()` provisions its own tenant with the default slug `demo`, so every client tenant in these tests uses `clientTenant()` (slug `klien`) to avoid a unique-slug conflict.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @siskop/backend exec vitest run tests/file-sniff.test.ts tests/migration-routes.test.ts`
Expected: FAIL — `"zip"` not returned; routes return 404.

- [ ] **Step 3: Extend `apps/backend/src/lib/file-sniff.ts`**

```ts
export type SniffedFileType = "jpg" | "png" | "pdf" | "zip";
```

and add to `SIGNATURES`:

```ts
  { type: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] } // "PK\x03\x04" — .xlsx is a zip container
```

- [ ] **Step 4: Create `apps/backend/src/modules/migration/upload.ts`**

```ts
import type { Request } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCode } from "@siskop/types";
import { AppError } from "../../lib/errors.js";
import { sniffFileType, type SniffedFileType } from "../../lib/file-sniff.js";

export const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** The uploaded file, verified by magic bytes rather than the declared MIME type. */
export function requireFile(req: Request, expected: SniffedFileType): Express.Multer.File {
  const file = req.file;
  if (!file) throw new AppError(ErrorCode.VALIDATION_ERROR, "Berkas wajib diunggah");
  if (sniffFileType(file.buffer) !== expected) {
    throw new AppError(ErrorCode.INVALID_FILE_TYPE, expected === "zip" ? "Berkas harus berformat .xlsx" : "Berkas harus berformat PDF");
  }
  return file;
}

/** Stores the signed berita acara next to other uploads; returns its public path. */
export async function storeBeritaAcara(tenantId: string, batchId: string, buffer: Buffer): Promise<{ url: string; filePath: string }> {
  const dir = path.join(process.env.STORAGE_PATH ?? "./uploads", "migration", tenantId);
  await mkdir(dir, { recursive: true });
  const name = `${batchId}-${randomUUID()}.pdf`;
  const filePath = path.join(dir, name);
  await writeFile(filePath, buffer);
  return { url: `/uploads/migration/${tenantId}/${name}`, filePath };
}
```

- [ ] **Step 5: Create `apps/backend/src/modules/migration/platform.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims } from "../../middleware/auth.js";
import { db } from "../../lib/db.js";
import { requireParam } from "../../lib/http.js";
import { createDraftBatch, discardBatch, getCurrentBatch, type Actor } from "./service.js";
import { memoryUpload, requireFile } from "./upload.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

async function actorOf(userId: string): Promise<Actor> {
  // findUnique is not tenant-guarded; the platform admin's row lives in another tenant.
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { id: userId, name: user?.name ?? "Tim SISKOP" };
}

/**
 * Mounted by platformRoutes() under /tenants/:tenantId/migrations, behind
 * requireAuth + requirePlatformAdmin. Draft-only by design: there is no
 * commit route here — only the tenant's own pengurus can post (routes.ts).
 */
export function platformMigrationRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/",
    memoryUpload.single("file"),
    handle(async (req, res) => {
      const file = requireFile(req, "zip");
      const data = await createDraftBatch(requireParam(req, "tenantId"), file, await actorOf(authClaims(req).userId));
      res.status(201).json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/current",
    handle(async (req, res) => {
      const data = await getCurrentBatch(requireParam(req, "tenantId"));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.delete(
    "/:batchId",
    handle(async (req, res) => {
      const data = await discardBatch(requireParam(req, "tenantId"), requireParam(req, "batchId"));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
```

- [ ] **Step 6: Create `apps/backend/src/modules/migration/routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { unlink } from "node:fs/promises";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { db } from "../../lib/db.js";
import { requireParam } from "../../lib/http.js";
import { commitBatch, getCurrentBatch } from "./service.js";
import { memoryUpload, requireFile, storeBeritaAcara } from "./upload.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Tenant side: tenantId always from req.auth (CLAUDE.md rule 1). */
export function migrationRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/current",
    requirePermission("migration", "read"),
    handle(async (req, res) => {
      const data = await getCurrentBatch(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/:batchId/commit",
    requirePermission("migration", "update"),
    memoryUpload.single("beritaAcara"),
    handle(async (req, res) => {
      const { tenantId, userId } = authClaims(req);
      const file = requireFile(req, "pdf");
      const batchId = requireParam(req, "batchId");
      const user = await db.user.findFirst({ where: { id: userId, tenantId }, select: { name: true } });
      const stored = await storeBeritaAcara(tenantId, batchId, file.buffer);
      try {
        const data = await commitBatch(tenantId, batchId, { id: userId, name: user?.name ?? "Pengurus" }, stored.url);
        res.json({ success: true, data, meta: res.locals.meta });
      } catch (err) {
        await unlink(stored.filePath).catch(() => undefined);
        throw err;
      }
    })
  );

  return router;
}
```

- [ ] **Step 7: Mount the routers**

`apps/backend/src/modules/platform/routes.ts`: add the import `import { platformMigrationRoutes } from "../migration/platform.routes.js";` and, directly after `router.use(requireAuth, requirePlatformAdmin);`:

```ts
  router.use("/tenants/:tenantId/migrations", platformMigrationRoutes());
```

`apps/backend/src/app.ts`: add the import `import { migrationRoutes } from "./modules/migration/routes.js";` and, after `app.use("/api/platform", platformRoutes());`:

```ts
  app.use("/api/migration", migrationRoutes());
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @siskop/backend exec vitest run tests/file-sniff.test.ts tests/migration-routes.test.ts tests/platform.test.ts`
Expected: PASS. Add `tmp-test-uploads/` to `apps/backend/.gitignore` if the test leaves files behind.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src apps/backend/tests apps/backend/.gitignore
git commit -m "feat(migration): platform draft routes and tenant approval route"
```

---

## Task 13: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/migration/README.md`

- [ ] **Step 1: Document the exception in `CLAUDE.md`**, at the end of non-negotiable rule 1:

```md
   Migrasi Saldo Awal is the one platform write into a tenant: platform admins
   upload a *draft* `MigrationBatch` via `/api/platform/tenants/:tenantId/migrations`
   (tenantId from the URL, like the other platform routes). A draft never touches
   members, savings, loans or the ledger; only a tenant user with `migration.update`
   commits it via `/api/migration/:batchId/commit`, with tenantId from `req.auth`.
```

- [ ] **Step 2: Note the importer in `docs/migration/README.md`** (append):

```md
## Importer

The backend importer (`apps/backend/src/modules/migration/`) reads exactly the row-1 keys
listed in `columns.ts`. Changing a column name means changing `columns.ts`, the generator
`build_template.py`, and regenerating the template together.
```

- [ ] **Step 3: Run the whole definition of done**

```bash
pnpm run lint && pnpm run typecheck && pnpm --filter @siskop/backend test
```

Expected: all PASS, backend line coverage ≥ 80%.

- [ ] **Step 4: Smoke-test with the anonymised Kopkar example**

Create an anonymised copy of the Kopkar example workbook (names → "Anggota 001…", no real data) **outside the repo**, upload it through the platform route against a local tenant whose unit is named "Simpan Pinjam Syariah", and confirm the report shows `ready: false` with exactly 4 `ADJUSTMENT_NOT_APPROVED` issues and every product-backed account `COCOK`. Do not commit the file.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/migration/README.md
git commit -m "docs: platform draft exception and migration importer notes"
```

---

## Follow-up plans (write after Plan A merges)

**Plan B: Platform Admin UI.** `apps/frontend/src/pages/platform/PlatformMigrationPage.tsx` at `/platform/tenants/:tenantId/migrasi`, linked from a "Migrasi Data" action in `PlatformTenantsPage.tsx`. It covers: an upload control (multipart `file`), a report view with summary tiles, per-account table and issue list grouped by sheet with row numbers, a discard button, and a version history label. It uses `MigrationBatchSummary` from `@siskop/types` and the existing `apiFetch`/`DataTable` components.

**Plan C: Tenant approval UI.** `apps/frontend/src/pages/migration/MigrationPage.tsx` at `/migrasi`, shown in the sidebar only while `GET /api/migration/current` returns a DRAFT and the user has `migration.read`. It covers:
- the Neraca pembuka side by side with the source names
- the adjustments list with reasons
- a berita acara PDF upload and a "Setujui & Posting" confirm step (in-page, no `confirm()`)
- after commit: read-only archive plus a post-commit checklist (set account mappings, mark cash accounts `isCashEquivalent`, collect KYC for members without NIK)
- adding `migration` to the permission editor in `pages/config/RolesTab.tsx`

**Later (not planned yet):** catch-up batches for live tenants, PDF-to-template extraction (Case 3), per-vendor legacy adapters (Case 1), fixed-asset register import, original loan principal/contract fields.
