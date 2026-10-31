# Platform Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/platform/dashboard` page for platform admins showing SISKOP performance, new tenant/user growth, member growth, regional spread, items needing attention, and revenue growth.

**Architecture:** One cross-tenant read endpoint `GET /api/platform/dashboard?range=` assembled from small aggregators (live SQL over `createdAt` / `Invoice` / `Payment`), plus a new hourly `RequestMetricHourly` table fed by an Express middleware for latency and 5xx rate. The React page renders six panels with Recharts.

**Tech Stack:** Express 4, Prisma 5 (raw SQL for date bucketing), Zod, Vitest + supertest (backend), React + TanStack Query + Recharts + shadcn/ui (frontend), `@siskop/types` (consumed from `dist`, so rebuild after every change there).

Spec: `docs/superpowers/specs/2026-10-31-platform-dashboard-design.md`

## Conventions every task relies on

- Backend imports use the `.js` suffix (`../../lib/db.js`). Tests live in `apps/backend/tests/*.test.ts`.
- Cross-tenant reads wrap each Prisma call in `withoutTenantScope(async () => ...)` from `lib/tenant-scope.ts`. Wrap only the specific call. `$queryRaw` is not guarded and needs no wrapper. This is the CLAUDE.md multi-tenant exception for platform-admin routes; the route is gated by `requirePlatformAdmin`.
- After editing `packages/types`, run `pnpm --filter @siskop/types build` (backend and frontend read `dist`).
- Backend tests run against `siskop_test`. Run a single file from `apps/backend` with `pnpm exec vitest run tests/<file>.test.ts` (no `--coverage`; the full suite takes about 13 minutes).
- Commit messages are conventional commits and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never start or stop anything on ports 3000/3001; they may be the user's servers.

## File structure

**Create**
- `packages/types/src/platform-dashboard.ts`: DTOs, `PROVINCES`, `provinceName`
- `apps/backend/prisma/migrations/20261031000000_platform_dashboard/migration.sql`
- `apps/backend/src/modules/platform-dashboard/buckets.ts`: range → zero-filled buckets
- `apps/backend/src/modules/platform-dashboard/counts.ts`: `countPerBucket` raw-SQL helper
- `apps/backend/src/modules/platform-dashboard/growth.ts`: tenants/users/members series
- `apps/backend/src/modules/platform-dashboard/revenue.ts`
- `apps/backend/src/modules/platform-dashboard/regions.ts`
- `apps/backend/src/modules/platform-dashboard/attention.ts`
- `apps/backend/src/modules/platform-dashboard/performance.ts`
- `apps/backend/src/modules/platform-dashboard/request-metrics.ts`: buffer, flush, middleware
- `apps/backend/src/modules/platform-dashboard/service.ts`, `routes.ts`, `schema.ts`
- Tests: `apps/backend/tests/platform-dashboard-{buckets,growth,revenue,regions,attention,performance,metrics,routes}.test.ts`
- `apps/frontend/src/pages/platform/PlatformDashboardPage.tsx`
- `apps/frontend/src/pages/platform/dashboard/{dashboardView.ts,dashboardView.test.ts,KpiCards.tsx,LinePanel.tsx,RevenuePanel.tsx,RegionPanel.tsx,AttentionPanel.tsx}`

**Modify**
- `packages/types/src/index.ts`, `packages/types/src/platform.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/modules/platform/{routes,schema,service}.ts`
- `apps/backend/src/app.ts`, `apps/backend/src/main.ts`
- `apps/frontend/src/App.tsx`, `components/layout/nav.ts`, `components/layout/nav.test.ts`, `components/layout/AppLayout.tsx`
- `apps/frontend/src/pages/platform/PlatformTenantsPage.tsx`

---

### Task 1: Shared types and province list

**Files:**
- Create: `packages/types/src/platform-dashboard.ts`
- Modify: `packages/types/src/index.ts`, `packages/types/src/platform.ts`

- [ ] **Step 1: Write the types**

Create `packages/types/src/platform-dashboard.ts`:

```ts
export type DashboardRange = "30d" | "90d" | "12m";
export const DASHBOARD_RANGES = ["30d", "90d", "12m"] as const satisfies readonly DashboardRange[];

/** Kemendagri province codes. `Tenant.province` stores the code. */
export const PROVINCES = [
  { code: "11", name: "Aceh" },
  { code: "12", name: "Sumatera Utara" },
  { code: "13", name: "Sumatera Barat" },
  { code: "14", name: "Riau" },
  { code: "15", name: "Jambi" },
  { code: "16", name: "Sumatera Selatan" },
  { code: "17", name: "Bengkulu" },
  { code: "18", name: "Lampung" },
  { code: "19", name: "Kepulauan Bangka Belitung" },
  { code: "21", name: "Kepulauan Riau" },
  { code: "31", name: "DKI Jakarta" },
  { code: "32", name: "Jawa Barat" },
  { code: "33", name: "Jawa Tengah" },
  { code: "34", name: "DI Yogyakarta" },
  { code: "35", name: "Jawa Timur" },
  { code: "36", name: "Banten" },
  { code: "51", name: "Bali" },
  { code: "52", name: "Nusa Tenggara Barat" },
  { code: "53", name: "Nusa Tenggara Timur" },
  { code: "61", name: "Kalimantan Barat" },
  { code: "62", name: "Kalimantan Tengah" },
  { code: "63", name: "Kalimantan Selatan" },
  { code: "64", name: "Kalimantan Timur" },
  { code: "65", name: "Kalimantan Utara" },
  { code: "71", name: "Sulawesi Utara" },
  { code: "72", name: "Sulawesi Tengah" },
  { code: "73", name: "Sulawesi Selatan" },
  { code: "74", name: "Sulawesi Tenggara" },
  { code: "75", name: "Gorontalo" },
  { code: "76", name: "Sulawesi Barat" },
  { code: "81", name: "Maluku" },
  { code: "82", name: "Maluku Utara" },
  { code: "91", name: "Papua" },
  { code: "92", name: "Papua Barat" },
  { code: "93", name: "Papua Selatan" },
  { code: "94", name: "Papua Tengah" },
  { code: "95", name: "Papua Pegunungan" },
  { code: "96", name: "Papua Barat Daya" }
] as const satisfies readonly { code: string; name: string }[];

export const UNSET_REGION_LABEL = "Belum diisi";

export function provinceName(code: string | null | undefined): string {
  if (!code) return UNSET_REGION_LABEL;
  return PROVINCES.find((p) => p.code === code)?.name ?? code;
}

export interface GrowthPoint {
  /** `YYYY-MM-DD` for 30d/90d, `YYYY-MM` for 12m. */
  bucket: string;
  tenants: number;
  users: number;
}

export interface MemberPoint {
  bucket: string;
  newMembers: number;
  totalMembers: number;
}

export interface ActivityPoint {
  bucket: string;
  /** `AuditLog` rows written in the bucket. */
  actions: number;
}

export interface TechnicalPoint {
  bucket: string;
  requests: number;
  /** 0..1 */
  errorRate: number;
  /** Null when the bucket has no requests. Daily/monthly values are count-weighted averages of hourly values (approximate). */
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface RegionRow {
  /** Province code, or null for tenants without a region. */
  code: string | null;
  name: string;
  tenants: number;
  users: number;
  members: number;
}

export type AttentionSeverity = "critical" | "warning" | "info";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  kind:
    | "INVOICE_OVERDUE"
    | "SUBSCRIPTION_PAST_DUE"
    | "BILLING_DUE_SOON"
    | "TENANT_INACTIVE"
    | "ERROR_RATE"
    | "TENANT_NO_REGION";
  message: string;
  /** In-app route to act on it. */
  href?: string;
}

export interface RevenuePoint {
  /** `YYYY-MM` */
  month: string;
  /** Decimal string, 2 places. */
  amount: string;
}

export interface RevenueSummary {
  /** Always the last 12 months, whatever the range filter. */
  series: RevenuePoint[];
  thisMonth: string;
  previousMonth: string;
  /** Percent change thisMonth vs previousMonth, 1 decimal; null when previousMonth is 0. */
  deltaPct: number | null;
  /** Monthly recurring revenue from ACTIVE subscriptions (YEARLY ÷ 12). Decimal string. */
  mrr: string;
}

export interface PlatformDashboard {
  range: DashboardRange;
  generatedAt: string;
  kpis: { tenants: number; users: number; members: number; mrr: string };
  performance: {
    activeTenants7d: number;
    activeTenants30d: number;
    activity: ActivityPoint[];
    technical: TechnicalPoint[];
  };
  growth: GrowthPoint[];
  members: { series: MemberPoint[]; total: number };
  regions: RegionRow[];
  attention: AttentionItem[];
  revenue: RevenueSummary;
}
```

- [ ] **Step 2: Export it and extend the tenant summary**

In `packages/types/src/index.ts` append `export * from "./platform-dashboard.js";`.

In `packages/types/src/platform.ts`, add two fields to `PlatformTenantSummary`:

```ts
  province: string | null;
  city: string | null;
```

and to `UpdateTenantStatusRequest`:

```ts
  province?: string | null;
  city?: string | null;
```

and to `CreateTenantRequest`:

```ts
  province?: string;
  city?: string;
```

- [ ] **Step 3: Build and typecheck**

Run: `pnpm --filter @siskop/types build`
Expected: exits 0. (Backend/frontend typecheck will fail on `PlatformTenantSummary` until Task 11; that is expected.)

- [ ] **Step 4: Commit**

```bash
git add packages/types/src
git commit -m "feat(types): platform dashboard DTOs and province list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20261031000000_platform_dashboard/migration.sql`

The migration is written by hand: `.env` may point at a non-test database, so do not run `migrate dev` here.

- [ ] **Step 1: Edit the Prisma schema**

In `model Tenant`, after the `cooperativeType` line add:

```prisma
  // Kemendagri 2-digit province code (see PROVINCES in @siskop/types) and a free-text city.
  // Null until a platform admin fills them in; the platform dashboard buckets those as "Belum diisi".
  province                   String?
  city                       String?
```

Append at the end of the file:

```prisma
// Platform-level request telemetry (no tenantId): one row per (hour, route pattern).
// p50/p95 are merged across flushes as count-weighted averages, so they are approximate.
model RequestMetricHourly {
  id         String   @id @default(cuid())
  hour       DateTime
  routeGroup String
  count      Int
  errors5xx  Int
  p50Ms      Int
  p95Ms      Int

  @@unique([hour, routeGroup])
  @@index([hour])
}
```

- [ ] **Step 2: Write the migration SQL**

`apps/backend/prisma/migrations/20261031000000_platform_dashboard/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "province" TEXT,
ADD COLUMN "city" TEXT;

-- CreateTable
CREATE TABLE "RequestMetricHourly" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "routeGroup" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "errors5xx" INTEGER NOT NULL,
    "p50Ms" INTEGER NOT NULL,
    "p95Ms" INTEGER NOT NULL,

    CONSTRAINT "RequestMetricHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestMetricHourly_hour_routeGroup_key" ON "RequestMetricHourly"("hour", "routeGroup");

-- CreateIndex
CREATE INDEX "RequestMetricHourly_hour_idx" ON "RequestMetricHourly"("hour");
```

- [ ] **Step 3: Apply to the test database and regenerate the client**

Stop any backend dev server first (Windows EPERM on the query engine DLL). From `apps/backend`:

```bash
set -a && . ./.env.test && set +a && pnpm exec prisma migrate deploy && pnpm exec prisma generate
```

Expected: `1 migration applied` (`20261031000000_platform_dashboard`) and `Generated Prisma Client`.

- [ ] **Step 4: Verify the schema and migration agree**

Run (from `apps/backend`): `set -a && . ./.env.test && set +a && pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --exit-code`
Expected: exit code 0 ("No difference"). If the shadow-database requirement is a problem, skip this step and rely on Step 3 plus the Task 3+ tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma
git commit -m "feat(platform): tenant region columns and request metrics table

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bucket helpers

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/buckets.ts`
- Test: `apps/backend/tests/platform-dashboard-buckets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildBuckets, fill, granularityOf, monthBuckets } from "../src/modules/platform-dashboard/buckets.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("buildBuckets", () => {
  it("returns 30 daily buckets ending today (UTC) for 30d", () => {
    const b = buildBuckets("30d", NOW);
    expect(b).toHaveLength(30);
    expect(b[0]?.key).toBe("2026-10-02");
    expect(b[29]?.key).toBe("2026-10-31");
  });

  it("returns 90 daily buckets for 90d", () => {
    expect(buildBuckets("90d", NOW)).toHaveLength(90);
  });

  it("returns 12 monthly buckets for 12m, oldest first", () => {
    const b = buildBuckets("12m", NOW);
    expect(b.map((x) => x.key)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"
    ]);
    expect(b[0]?.start.toISOString()).toBe("2025-11-01T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const b = monthBuckets(new Date("2026-02-10T00:00:00Z"), 3);
    expect(b.map((x) => x.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("granularityOf / fill", () => {
  it("uses month granularity only for 12m", () => {
    expect(granularityOf("30d")).toBe("day");
    expect(granularityOf("90d")).toBe("day");
    expect(granularityOf("12m")).toBe("month");
  });

  it("zero-fills buckets missing from the sparse rows", () => {
    const buckets = monthBuckets(NOW, 2);
    const out = fill(buckets, new Map([["2026-10", 5]]), () => 0);
    expect(out).toEqual([0, 5]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `apps/backend`): `pnpm exec vitest run tests/platform-dashboard-buckets.test.ts`
Expected: FAIL, cannot find module `buckets.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/buckets.ts`:

```ts
import type { DashboardRange } from "@siskop/types";

export type Granularity = "day" | "month";

export interface Bucket {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month). */
  key: string;
  /** Inclusive UTC start of the bucket. */
  start: Date;
}

const DAY_MS = 86_400_000;

export const granularityOf = (range: DashboardRange): Granularity => (range === "12m" ? "month" : "day");

const bucketCount = (range: DashboardRange): number => (range === "30d" ? 30 : range === "90d" ? 90 : 12);

/** The last `count` calendar months ending with `now`'s month, oldest first (UTC). */
export function monthBuckets(now: Date, count: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: start.toISOString().slice(0, 7), start });
  }
  return out;
}

/** Zero-filled, oldest-first buckets for a dashboard range. */
export function buildBuckets(range: DashboardRange, now: Date): Bucket[] {
  if (granularityOf(range) === "month") return monthBuckets(now, bucketCount(range));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: Bucket[] = [];
  for (let i = bucketCount(range) - 1; i >= 0; i--) {
    const start = new Date(today - i * DAY_MS);
    out.push({ key: start.toISOString().slice(0, 10), start });
  }
  return out;
}

/** One value per bucket: the sparse row if present, else `empty(key)`. */
export function fill<T>(buckets: Bucket[], byKey: Map<string, T>, empty: (key: string) => T): T[] {
  return buckets.map((b) => byKey.get(b.key) ?? empty(b.key));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-buckets.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/buckets.ts apps/backend/tests/platform-dashboard-buckets.test.ts
git commit -m "feat(platform): dashboard range bucket helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Growth and member series

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/counts.ts`, `growth.ts`
- Test: `apps/backend/tests/platform-dashboard-growth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getGrowth, getMembers } from "../src/modules/platform-dashboard/growth.js";
import { createMemberAs, createPlatformAdminSession, setupTenant } from "./helpers.js";

const NOW = new Date("2026-10-31T12:00:00Z");

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function backdate(table: "Tenant" | "User" | "Member", tenantId: string, at: string) {
  const column = table === "Tenant" ? '"id"' : '"tenantId"';
  await db.$executeRawUnsafe(`UPDATE "${table}" SET "createdAt" = $1 WHERE ${column} = $2`, new Date(at), tenantId);
}

describe("getGrowth", () => {
  it("counts new tenants and staff users per day, zero-filled", async () => {
    const s = await setupTenant();
    await backdate("Tenant", s.user.tenantId, "2026-10-30T08:00:00Z");
    await backdate("User", s.user.tenantId, "2026-10-29T08:00:00Z");

    const series = await getGrowth("30d", NOW);

    expect(series).toHaveLength(30);
    expect(series.find((p) => p.bucket === "2026-10-30")).toMatchObject({ tenants: 1, users: 0 });
    expect(series.find((p) => p.bucket === "2026-10-29")).toMatchObject({ tenants: 0, users: 1 });
    expect(series.find((p) => p.bucket === "2026-10-31")).toMatchObject({ tenants: 0, users: 0 });
  });

  it("does not count platform admins as users", async () => {
    const session = await createPlatformAdminSession();
    await backdate("User", session.user.tenantId, "2026-10-30T08:00:00Z");

    const series = await getGrowth("30d", NOW);

    // The tenant has one staff admin and one platform admin; only the staff admin counts.
    expect(series.find((p) => p.bucket === "2026-10-30")?.users).toBe(1);
  });

  it("buckets by month for 12m", async () => {
    const s = await setupTenant();
    await backdate("Tenant", s.user.tenantId, "2026-03-15T08:00:00Z");

    const series = await getGrowth("12m", NOW);

    expect(series).toHaveLength(12);
    expect(series.find((p) => p.bucket === "2026-03")?.tenants).toBe(1);
  });
});

describe("getMembers", () => {
  it("adds in-window members to the running total", async () => {
    const s = await setupTenant();
    await createMemberAs(s.accessToken);
    await backdate("Member", s.user.tenantId, "2026-10-15T08:00:00Z");

    const { series, total } = await getMembers("30d", NOW);

    expect(total).toBe(1);
    expect(series.find((p) => p.bucket === "2026-10-14")).toMatchObject({ newMembers: 0, totalMembers: 0 });
    expect(series.find((p) => p.bucket === "2026-10-15")).toMatchObject({ newMembers: 1, totalMembers: 1 });
    expect(series.at(-1)).toMatchObject({ newMembers: 0, totalMembers: 1 });
  });

  it("starts the running total from members created before the window", async () => {
    const s = await setupTenant();
    await createMemberAs(s.accessToken);
    await backdate("Member", s.user.tenantId, "2026-08-01T08:00:00Z");

    const { series, total } = await getMembers("30d", NOW);

    expect(total).toBe(1);
    expect(series[0]).toMatchObject({ newMembers: 0, totalMembers: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-growth.test.ts`
Expected: FAIL, cannot find module `growth.js`.

- [ ] **Step 3: Implement the counting helper**

`apps/backend/src/modules/platform-dashboard/counts.ts`:

```ts
import { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import type { Granularity } from "./buckets.js";

type CountedTable = "Tenant" | "User" | "Member" | "AuditLog";

/**
 * Rows created since `since`, grouped into UTC day/month buckets keyed like
 * buckets.ts (`YYYY-MM-DD` / `YYYY-MM`). Cross-tenant by design: callers are
 * platform-admin only. `extra` is a trusted SQL fragment, never user input.
 */
export async function countPerBucket(
  table: CountedTable,
  granularity: Granularity,
  since: Date,
  extra: Prisma.Sql = Prisma.empty
): Promise<Map<string, number>> {
  const format = granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const rows = await db.$queryRaw<{ bucket: string; n: bigint }[]>(Prisma.sql`
    SELECT to_char(date_trunc(${granularity}::text, "createdAt"), ${format}::text) AS bucket, COUNT(*) AS n
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "createdAt" >= ${since} ${extra}
    GROUP BY 1
  `);
  return new Map(rows.map((r) => [r.bucket, Number(r.n)]));
}
```

- [ ] **Step 4: Implement growth**

`apps/backend/src/modules/platform-dashboard/growth.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { DashboardRange, GrowthPoint, MemberPoint } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { buildBuckets, fill, granularityOf } from "./buckets.js";
import { countPerBucket } from "./counts.js";

const STAFF_ONLY = Prisma.sql`AND "isPlatformAdmin" = false`;

/** New tenants and new staff users (platform admins excluded) per bucket. */
export async function getGrowth(range: DashboardRange, now: Date): Promise<GrowthPoint[]> {
  const buckets = buildBuckets(range, now);
  const g = granularityOf(range);
  const since = buckets[0]!.start;
  const [tenants, users] = await Promise.all([
    countPerBucket("Tenant", g, since),
    countPerBucket("User", g, since, STAFF_ONLY)
  ]);
  return buckets.map((b) => ({ bucket: b.key, tenants: tenants.get(b.key) ?? 0, users: users.get(b.key) ?? 0 }));
}

/** New members per bucket plus a running total that starts from members created before the window. */
export async function getMembers(range: DashboardRange, now: Date): Promise<{ series: MemberPoint[]; total: number }> {
  const buckets = buildBuckets(range, now);
  const since = buckets[0]!.start;
  const [created, before] = await Promise.all([
    countPerBucket("Member", granularityOf(range), since),
    withoutTenantScope(async () => db.member.count({ where: { createdAt: { lt: since } } }))
  ]);
  let running = before;
  const series = fill<MemberPoint>(
    buckets,
    new Map(),
    (bucket) => ({ bucket, newMembers: 0, totalMembers: 0 })
  ).map((point) => {
    const newMembers = created.get(point.bucket) ?? 0;
    running += newMembers;
    return { bucket: point.bucket, newMembers, totalMembers: running };
  });
  return { series, total: running };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-growth.test.ts`
Expected: PASS (5 tests). If `date_trunc(... ::text ...)` or `to_char` parameter typing errors appear, keep the `::text` casts and report the exact Postgres error rather than switching to string-built SQL.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard apps/backend/tests/platform-dashboard-growth.test.ts
git commit -m "feat(platform): tenant, user and member growth series

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Revenue and MRR

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/revenue.ts`
- Test: `apps/backend/tests/platform-dashboard-revenue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { deltaPct, getRevenue, mrrOf } from "../src/modules/platform-dashboard/revenue.js";
import { makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const D = (v: string) => new Prisma.Decimal(v);

describe("deltaPct", () => {
  it("is the percent change to one decimal", () => {
    expect(deltaPct(D("150"), D("100"))).toBe(50);
    expect(deltaPct(D("100"), D("300"))).toBe(-66.7);
  });
  it("is null when there is no previous month to compare", () => {
    expect(deltaPct(D("100"), D("0"))).toBeNull();
  });
});

describe("mrrOf", () => {
  it("counts monthly as-is and spreads yearly over 12 months", () => {
    const total = mrrOf([
      { billingCycle: "MONTHLY", amountPerCycle: D("500000") },
      { billingCycle: "YEARLY", amountPerCycle: D("1200000") }
    ]);
    expect(total.toFixed(2)).toBe("600000.00");
  });
});

describe("getRevenue", () => {
  beforeEach(async () => {
    await db.tenant.deleteMany({});
    await seedCatalog();
  });

  it("sums payments on PAID invoices per month and ignores unpaid invoices", async () => {
    const paid = await makeSubscribedTenant({ tag: "REVA", status: "ACTIVE", invoice: { status: "PAID" } });
    const open = await makeSubscribedTenant({ tag: "REVB", status: "ACTIVE", invoice: { status: "OPEN" } });
    await db.payment.create({
      data: { tenantId: paid.tenant.id, invoiceId: paid.invoice!.id, method: "VA", amount: "500000", paidAt: new Date("2026-10-15T00:00:00Z") }
    });
    await db.payment.create({
      data: { tenantId: paid.tenant.id, invoiceId: paid.invoice!.id, method: "VA", amount: "250000", paidAt: new Date("2026-09-10T00:00:00Z") }
    });
    await db.payment.create({
      data: { tenantId: open.tenant.id, invoiceId: open.invoice!.id, method: "VA", amount: "999999", paidAt: new Date("2026-10-20T00:00:00Z") }
    });

    const r = await getRevenue(NOW);

    expect(r.series).toHaveLength(12);
    expect(r.series.at(-1)).toEqual({ month: "2026-10", amount: "500000.00" });
    expect(r.series.at(-2)).toEqual({ month: "2026-09", amount: "250000.00" });
    expect(r.thisMonth).toBe("500000.00");
    expect(r.previousMonth).toBe("250000.00");
    expect(r.deltaPct).toBe(100);
  });

  it("reports MRR from ACTIVE subscriptions only", async () => {
    const active = await makeSubscribedTenant({ tag: "MRRA", status: "ACTIVE", invoice: null });
    await makeSubscribedTenant({ tag: "MRRB", status: "PENDING_PAYMENT", invoice: null });

    const r = await getRevenue(NOW);

    expect(r.mrr).toBe(active.subscription.amountPerCycle.toFixed(2));
  });
});
```

(`makeSubscribedTenant` defaults to a MONTHLY `small` package, so `amountPerCycle` is already the monthly figure.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-revenue.test.ts`
Expected: FAIL, cannot find module `revenue.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/revenue.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { RevenueSummary } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { monthBuckets } from "./buckets.js";

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => d.toFixed(2);

/** Percent change to one decimal; null when there is nothing to compare against. */
export function deltaPct(current: Prisma.Decimal, previous: Prisma.Decimal): number | null {
  if (previous.isZero()) return null;
  return Math.round(current.minus(previous).div(previous).times(1000).toNumber()) / 10;
}

/** Monthly recurring revenue: MONTHLY as-is, YEARLY divided by 12. */
export function mrrOf(subs: { billingCycle: "MONTHLY" | "YEARLY"; amountPerCycle: Prisma.Decimal }[]): Prisma.Decimal {
  return subs.reduce((sum, s) => sum.plus(s.billingCycle === "YEARLY" ? s.amountPerCycle.div(12) : s.amountPerCycle), ZERO);
}

/** Cash-basis revenue: payments recorded against PAID subscription invoices, per month, last 12 months. */
export async function getRevenue(now: Date): Promise<RevenueSummary> {
  const months = monthBuckets(now, 12);
  const since = months[0]!.start;

  const [rows, subs] = await Promise.all([
    db.$queryRaw<{ bucket: string; total: string }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', p."paidAt"), 'YYYY-MM') AS bucket, SUM(p.amount)::text AS total
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      WHERE i.status = 'PAID' AND p."paidAt" >= ${since}
      GROUP BY 1
    `),
    withoutTenantScope(async () =>
      db.tenantSubscription.findMany({ where: { status: "ACTIVE" }, select: { billingCycle: true, amountPerCycle: true } })
    )
  ]);

  const byMonth = new Map(rows.map((r) => [r.bucket, new Prisma.Decimal(r.total)]));
  const series = months.map((m) => ({ month: m.key, amount: money(byMonth.get(m.key) ?? ZERO) }));
  const thisMonth = byMonth.get(months.at(-1)!.key) ?? ZERO;
  const previousMonth = byMonth.get(months.at(-2)!.key) ?? ZERO;

  return {
    series,
    thisMonth: money(thisMonth),
    previousMonth: money(previousMonth),
    deltaPct: deltaPct(thisMonth, previousMonth),
    mrr: money(mrrOf(subs))
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-revenue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/revenue.ts apps/backend/tests/platform-dashboard-revenue.test.ts
git commit -m "feat(platform): revenue series and MRR for the dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Regional distribution

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/regions.ts`
- Test: `apps/backend/tests/platform-dashboard-regions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getRegions } from "../src/modules/platform-dashboard/regions.js";
import { createMemberAs, setupTenant } from "./helpers.js";

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("getRegions", () => {
  it("groups tenants, staff users and members by province, with unset last", async () => {
    const jatim = await setupTenant();
    await db.tenant.update({ where: { id: jatim.user.tenantId }, data: { province: "35", city: "Surabaya" } });
    await createMemberAs(jatim.accessToken);
    await setupTenant({ slug: "tanpa", registrationNo: "KOP-TANPA" });

    const rows = await getRegions();

    expect(rows).toEqual([
      { code: "35", name: "Jawa Timur", tenants: 1, users: 1, members: 1 },
      { code: null, name: "Belum diisi", tenants: 1, users: 1, members: 0 }
    ]);
  });

  it("falls back to the raw code for a province not in the list", async () => {
    const s = await setupTenant();
    await db.tenant.update({ where: { id: s.user.tenantId }, data: { province: "99" } });

    const rows = await getRegions();

    expect(rows[0]).toMatchObject({ code: "99", name: "99" });
  });

  it("returns an empty list when there are no tenants", async () => {
    expect(await getRegions()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-regions.test.ts`
Expected: FAIL, cannot find module `regions.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/regions.ts`:

```ts
import { Prisma } from "@prisma/client";
import { provinceName, type RegionRow } from "@siskop/types";
import { db } from "../../lib/db.js";

type Counts = { province: string | null; n: bigint }[];

/** Tenants, staff users and members per province. Tenants without a province form the last "Belum diisi" row. */
export async function getRegions(): Promise<RegionRow[]> {
  const [tenants, users, members] = await Promise.all([
    db.$queryRaw<Counts>(Prisma.sql`SELECT province, COUNT(*) AS n FROM "Tenant" GROUP BY province`),
    db.$queryRaw<Counts>(Prisma.sql`
      SELECT t.province, COUNT(*) AS n FROM "User" u JOIN "Tenant" t ON t.id = u."tenantId"
      WHERE u."isPlatformAdmin" = false GROUP BY t.province`),
    db.$queryRaw<Counts>(Prisma.sql`
      SELECT t.province, COUNT(*) AS n FROM "Member" m JOIN "Tenant" t ON t.id = m."tenantId" GROUP BY t.province`)
  ]);

  const rows = new Map<string | null, RegionRow>();
  const row = (code: string | null): RegionRow => {
    let r = rows.get(code);
    if (!r) {
      r = { code, name: provinceName(code), tenants: 0, users: 0, members: 0 };
      rows.set(code, r);
    }
    return r;
  };
  for (const t of tenants) row(t.province).tenants = Number(t.n);
  for (const u of users) row(u.province).users = Number(u.n);
  for (const m of members) row(m.province).members = Number(m.n);

  return [...rows.values()].sort((a, b) => {
    if (a.code === null) return 1;
    if (b.code === null) return -1;
    return b.members - a.members || b.users - a.users || b.tenants - a.tenants || a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-regions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/regions.ts apps/backend/tests/platform-dashboard-regions.test.ts
git commit -m "feat(platform): regional distribution of tenants, users and members

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Request metrics (buffer, flush, middleware)

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/request-metrics.ts`
- Test: `apps/backend/tests/platform-dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { flushMetrics, hourOf, percentile, recordRequest, requestMetrics } from "../src/modules/platform-dashboard/request-metrics.js";

beforeEach(async () => {
  await flushMetrics();
  await db.requestMetricHourly.deleteMany({});
});

describe("percentile", () => {
  it("uses nearest-rank on a sorted list", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("hourOf", () => {
  it("truncates to the UTC hour", () => {
    expect(hourOf(new Date("2026-10-31T12:34:56Z")).toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
});

describe("flushMetrics", () => {
  it("stores count, 5xx count and percentiles per (hour, route)", async () => {
    const hour = hourOf(new Date("2026-10-31T12:00:00Z"));
    for (const ms of [10, 20, 30, 40]) recordRequest(hour, "GET /api/x", ms, 200);
    recordRequest(hour, "GET /api/x", 500, 503);

    await flushMetrics();

    const row = await db.requestMetricHourly.findFirstOrThrow({ where: { routeGroup: "GET /api/x" } });
    expect(row).toMatchObject({ count: 5, errors5xx: 1, p50Ms: 30, p95Ms: 500 });
  });

  it("merges a second flush into the same hour row", async () => {
    const hour = hourOf(new Date("2026-10-31T13:00:00Z"));
    recordRequest(hour, "GET /api/y", 100, 200);
    await flushMetrics();
    recordRequest(hour, "GET /api/y", 300, 500);
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany({ where: { routeGroup: "GET /api/y" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, errors5xx: 1, p50Ms: 200 });
  });

  it("is a no-op with an empty buffer", async () => {
    await expect(flushMetrics()).resolves.toBeUndefined();
    expect(await db.requestMetricHourly.count()).toBe(0);
  });
});

describe("requestMetrics middleware", () => {
  it("records the route pattern, not the raw URL, and skips health checks", async () => {
    const app = express();
    const router = Router();
    router.get("/items/:id", (_req, res) => res.status(500).json({}));
    router.get("/health", (_req, res) => res.json({}));
    app.use(requestMetrics());
    app.use("/api", router);

    await request(app).get("/api/items/7");
    await request(app).get("/api/items/8");
    await request(app).get("/api/health");
    await request(app).get("/nowhere");
    await new Promise((resolve) => setImmediate(resolve));
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany({ orderBy: { routeGroup: "asc" } });
    expect(rows.map((r) => [r.routeGroup, r.count, r.errors5xx])).toEqual([
      ["GET /api/items/:id", 2, 2],
      ["unmatched", 1, 0]
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-metrics.test.ts`
Expected: FAIL, cannot find module `request-metrics.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/request-metrics.ts`:

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../../lib/db.js";

interface Sample {
  hour: Date;
  routeGroup: string;
  durations: number[];
  errors: number;
}

/** In-memory samples since the last flush, keyed `${hourIso}|${routeGroup}`. */
let buffer = new Map<string, Sample>();

/** Per key per flush window; extra samples still count but no longer feed the percentiles. */
const MAX_SAMPLES = 5_000;
const MAX_GROUP_LENGTH = 120;
const SKIPPED_PATHS = new Set(["/health", "/api/health"]);

export function hourOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export function recordRequest(hour: Date, routeGroup: string, durationMs: number, status: number): void {
  const key = `${hour.toISOString()}|${routeGroup}`;
  let sample = buffer.get(key);
  if (!sample) {
    sample = { hour, routeGroup, durations: [], errors: 0 };
    buffer.set(key, sample);
  }
  if (sample.durations.length < MAX_SAMPLES) sample.durations.push(durationMs);
  if (status >= 500) sample.errors += 1;
}

/** Writes and clears the buffer. A failed write drops that window rather than blocking requests. */
export async function flushMetrics(): Promise<void> {
  if (buffer.size === 0) return;
  const batch = buffer;
  buffer = new Map();
  for (const sample of batch.values()) {
    const sorted = [...sample.durations].sort((a, b) => a - b);
    const n = sorted.length;
    const p50 = Math.round(percentile(sorted, 50));
    const p95 = Math.round(percentile(sorted, 95));
    try {
      await db.$transaction(async (tx) => {
        const where = { hour_routeGroup: { hour: sample.hour, routeGroup: sample.routeGroup } };
        const existing = await tx.requestMetricHourly.findUnique({ where });
        if (!existing) {
          await tx.requestMetricHourly.create({
            data: { hour: sample.hour, routeGroup: sample.routeGroup, count: n, errors5xx: sample.errors, p50Ms: p50, p95Ms: p95 }
          });
          return;
        }
        const total = existing.count + n;
        await tx.requestMetricHourly.update({
          where,
          data: {
            count: total,
            errors5xx: existing.errors5xx + sample.errors,
            p50Ms: Math.round((existing.p50Ms * existing.count + p50 * n) / total),
            p95Ms: Math.round((existing.p95Ms * existing.count + p95 * n) / total)
          }
        });
      });
    } catch (err) {
      console.error("request metrics flush failed", err);
    }
  }
}

export function routeGroupOf(req: Request): string {
  const path = req.route?.path;
  if (path === undefined) return "unmatched";
  return `${req.method} ${req.baseUrl}${String(path)}`.slice(0, MAX_GROUP_LENGTH);
}

/** Times every request and buffers it under its route pattern. Never blocks or fails a request. */
export function requestMetrics(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (SKIPPED_PATHS.has(req.originalUrl.split("?")[0] ?? "")) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      recordRequest(hourOf(new Date()), routeGroupOf(req), ms, res.statusCode);
    });
    next();
  };
}

/** Periodic flush for the running server. The timer is unref'd so it never keeps the process alive. */
export function startMetricsFlush(intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => void flushMetrics(), intervalMs);
  timer.unref();
  return timer;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-metrics.test.ts`
Expected: PASS (6 tests). If the middleware test shows `GET /items/:id` instead of `GET /api/items/:id`, `req.baseUrl` was already reset when `finish` fired: capture `req.baseUrl` inside a `res.on("finish")`-independent hook by computing the group in an `onHeaders`-style wrapper (`const end = res.end; res.end = function (...a) { group = routeGroupOf(req); return end.apply(this, a); }`), then re-run. Do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/request-metrics.ts apps/backend/tests/platform-dashboard-metrics.test.ts
git commit -m "feat(platform): hourly request latency and error telemetry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Performance (activity + technical)

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/performance.ts`
- Test: `apps/backend/tests/platform-dashboard-performance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { buildBuckets } from "../src/modules/platform-dashboard/buckets.js";
import { aggregateTechnical, getPerformance } from "../src/modules/platform-dashboard/performance.js";
import { setupTenant } from "./helpers.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("aggregateTechnical", () => {
  const buckets = buildBuckets("30d", NOW);

  it("sums requests/errors and count-weights percentiles within a day", () => {
    const points = aggregateTechnical(
      [
        { hour: new Date("2026-10-30T09:00:00Z"), count: 100, errors5xx: 2, p50Ms: 40, p95Ms: 200 },
        { hour: new Date("2026-10-30T10:00:00Z"), count: 300, errors5xx: 6, p50Ms: 80, p95Ms: 400 }
      ],
      buckets,
      "day"
    );
    expect(points.find((p) => p.bucket === "2026-10-30")).toEqual({
      bucket: "2026-10-30",
      requests: 400,
      errorRate: 0.02,
      p50Ms: 70,
      p95Ms: 350
    });
  });

  it("leaves latency null where there were no requests", () => {
    const points = aggregateTechnical([], buckets, "day");
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({ bucket: "2026-10-02", requests: 0, errorRate: 0, p50Ms: null, p95Ms: null });
  });
});

describe("getPerformance", () => {
  beforeEach(async () => {
    await db.tenant.deleteMany({});
    await db.requestMetricHourly.deleteMany({});
  });

  it("counts tenants with a staff login in the last 7 and 30 days", async () => {
    const recent = await setupTenant();
    const older = await setupTenant({ slug: "lama", registrationNo: "KOP-LAMA" });
    await setupTenant({ slug: "belum", registrationNo: "KOP-BELUM" });
    await db.$executeRawUnsafe(`UPDATE "User" SET "lastLoginAt" = $1 WHERE "tenantId" = $2`, new Date("2026-10-30T00:00:00Z"), recent.user.tenantId);
    await db.$executeRawUnsafe(`UPDATE "User" SET "lastLoginAt" = $1 WHERE "tenantId" = $2`, new Date("2026-10-10T00:00:00Z"), older.user.tenantId);
    await db.$executeRawUnsafe(`UPDATE "User" SET "lastLoginAt" = NULL WHERE "tenantId" NOT IN ($1, $2)`, recent.user.tenantId, older.user.tenantId);

    const p = await getPerformance("30d", NOW);

    expect(p.activeTenants7d).toBe(1);
    expect(p.activeTenants30d).toBe(2);
  });

  it("buckets audit-log actions per day and reads stored request metrics", async () => {
    const s = await setupTenant();
    await db.$executeRawUnsafe(
      `INSERT INTO "AuditLog" ("id","tenantId","action","requestId","createdAt") VALUES ('al1', $1, 'X', 'r1', $2), ('al2', $1, 'X', 'r2', $2)`,
      s.user.tenantId,
      new Date("2026-10-30T09:00:00Z")
    );
    await db.requestMetricHourly.create({
      data: { hour: new Date("2026-10-30T09:00:00Z"), routeGroup: "GET /api/a", count: 10, errors5xx: 1, p50Ms: 20, p95Ms: 90 }
    });

    const p = await getPerformance("30d", NOW);

    expect(p.activity.find((a) => a.bucket === "2026-10-30")?.actions).toBe(2);
    expect(p.technical.find((t) => t.bucket === "2026-10-30")).toMatchObject({ requests: 10, errorRate: 0.1, p50Ms: 20, p95Ms: 90 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-performance.test.ts`
Expected: FAIL, cannot find module `performance.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/performance.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { ActivityPoint, DashboardRange, TechnicalPoint } from "@siskop/types";
import { db } from "../../lib/db.js";
import { buildBuckets, granularityOf, type Bucket, type Granularity } from "./buckets.js";
import { countPerBucket } from "./counts.js";

const DAY_MS = 86_400_000;

interface MetricRow {
  hour: Date;
  count: number;
  errors5xx: number;
  p50Ms: number;
  p95Ms: number;
}

/** Folds hourly rows into the range's buckets. Percentiles are count-weighted averages, so approximate. */
export function aggregateTechnical(rows: MetricRow[], buckets: Bucket[], granularity: Granularity): TechnicalPoint[] {
  const sliceLength = granularity === "day" ? 10 : 7;
  const acc = new Map<string, { requests: number; errors: number; p50: number; p95: number }>();
  for (const r of rows) {
    const key = r.hour.toISOString().slice(0, sliceLength);
    const a = acc.get(key) ?? { requests: 0, errors: 0, p50: 0, p95: 0 };
    a.requests += r.count;
    a.errors += r.errors5xx;
    a.p50 += r.p50Ms * r.count;
    a.p95 += r.p95Ms * r.count;
    acc.set(key, a);
  }
  return buckets.map((b) => {
    const a = acc.get(b.key);
    if (!a || a.requests === 0) return { bucket: b.key, requests: 0, errorRate: 0, p50Ms: null, p95Ms: null };
    return {
      bucket: b.key,
      requests: a.requests,
      errorRate: Math.round((a.errors / a.requests) * 10_000) / 10_000,
      p50Ms: Math.round(a.p50 / a.requests),
      p95Ms: Math.round(a.p95 / a.requests)
    };
  });
}

async function activeTenantsSince(since: Date): Promise<number> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT "tenantId") AS n FROM "User"
    WHERE "isPlatformAdmin" = false AND "lastLoginAt" >= ${since}
  `);
  return Number(row?.n ?? 0);
}

export async function getPerformance(range: DashboardRange, now: Date) {
  const buckets = buildBuckets(range, now);
  const g = granularityOf(range);
  const since = buckets[0]!.start;

  const [active7, active30, actions, metrics] = await Promise.all([
    activeTenantsSince(new Date(now.getTime() - 7 * DAY_MS)),
    activeTenantsSince(new Date(now.getTime() - 30 * DAY_MS)),
    countPerBucket("AuditLog", g, since),
    db.requestMetricHourly.findMany({ where: { hour: { gte: since } } })
  ]);

  const activity: ActivityPoint[] = buckets.map((b) => ({ bucket: b.key, actions: actions.get(b.key) ?? 0 }));
  return {
    activeTenants7d: active7,
    activeTenants30d: active30,
    activity,
    technical: aggregateTechnical(metrics, buckets, g)
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-performance.test.ts`
Expected: PASS (4 tests). If the `INSERT INTO "AuditLog"` fails on a NOT NULL column, add the missing column to the test's INSERT; do not change the table.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/performance.ts apps/backend/tests/platform-dashboard-performance.test.ts
git commit -m "feat(platform): activity and technical performance series

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Attention items

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/attention.ts`
- Test: `apps/backend/tests/platform-dashboard-attention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { errorRateAlert, getAttention, sortAttention } from "../src/modules/platform-dashboard/attention.js";
import { DAY, daysFrom, makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("errorRateAlert", () => {
  it("needs both enough traffic and a 5% error rate", () => {
    expect(errorRateAlert(1000, 50)).not.toBeNull();
    expect(errorRateAlert(1000, 49)).toBeNull();
    expect(errorRateAlert(19, 19)).toBeNull();
  });
});

describe("sortAttention", () => {
  it("orders critical, warning, info and keeps order within a severity", () => {
    const sorted = sortAttention([
      { id: "a", severity: "info", kind: "TENANT_NO_REGION", message: "a" },
      { id: "b", severity: "critical", kind: "ERROR_RATE", message: "b" },
      { id: "c", severity: "warning", kind: "TENANT_INACTIVE", message: "c" },
      { id: "d", severity: "critical", kind: "INVOICE_OVERDUE", message: "d" }
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("getAttention", () => {
  beforeEach(async () => {
    await db.tenant.deleteMany({});
    await db.requestMetricHourly.deleteMany({});
    await seedCatalog();
  });

  it("flags an OPEN invoice past its due date as critical", async () => {
    await makeSubscribedTenant({
      tag: "OVD",
      status: "ACTIVE",
      invoice: { dueDate: daysFrom(NOW, -5) }
    });
    const items = await getAttention(NOW);
    const overdue = items.find((i) => i.kind === "INVOICE_OVERDUE");
    expect(overdue).toMatchObject({ severity: "critical", href: "/platform/invoices" });
    expect(overdue?.message).toContain("Koperasi OVD");
    expect(overdue?.message).toContain("5 hari");
  });

  it("does not flag a paid or not-yet-due invoice", async () => {
    await makeSubscribedTenant({ tag: "PD", status: "ACTIVE", invoice: { status: "PAID", dueDate: daysFrom(NOW, -5) } });
    await makeSubscribedTenant({ tag: "FUT", status: "ACTIVE", invoice: { dueDate: daysFrom(NOW, 5) } });
    const items = await getAttention(NOW);
    expect(items.some((i) => i.kind === "INVOICE_OVERDUE")).toBe(false);
  });

  it("counts PAST_DUE subscriptions and renewals due within 7 days", async () => {
    await makeSubscribedTenant({ tag: "PAST", status: "PAST_DUE", invoice: null });
    await makeSubscribedTenant({ tag: "SOON", status: "ACTIVE", nextBillingDate: daysFrom(NOW, 3), invoice: null });
    await makeSubscribedTenant({ tag: "LATER", status: "ACTIVE", nextBillingDate: daysFrom(NOW, 20), invoice: null });
    const items = await getAttention(NOW);
    expect(items.find((i) => i.kind === "SUBSCRIPTION_PAST_DUE")?.message).toContain("1 langganan");
    expect(items.find((i) => i.kind === "BILLING_DUE_SOON")?.message).toContain("1 langganan");
  });

  it("lists active tenants nobody has logged into for 30 days, and tenants with no region", async () => {
    const t = await makeSubscribedTenant({ tag: "IDLE", status: "ACTIVE", invoice: null });
    await db.tenant.update({ where: { id: t.tenant.id }, data: { createdAt: new Date(NOW.getTime() - 60 * DAY) } });
    const items = await getAttention(NOW);
    expect(items.find((i) => i.kind === "TENANT_INACTIVE")?.message).toContain("Koperasi IDLE");
    expect(items.find((i) => i.kind === "TENANT_NO_REGION")).toMatchObject({ severity: "info", href: "/platform/tenants" });
  });

  it("raises ERROR_RATE from the last 24h of stored metrics", async () => {
    await db.requestMetricHourly.create({
      data: { hour: new Date("2026-10-31T09:00:00Z"), routeGroup: "GET /api/a", count: 200, errors5xx: 30, p50Ms: 10, p95Ms: 50 }
    });
    const items = await getAttention(NOW);
    expect(items[0]).toMatchObject({ kind: "ERROR_RATE", severity: "critical" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-attention.test.ts`
Expected: FAIL, cannot find module `attention.js`.

- [ ] **Step 3: Implement**

`apps/backend/src/modules/platform-dashboard/attention.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { AttentionItem, AttentionSeverity } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

const DAY_MS = 86_400_000;
const MAX_OVERDUE_LISTED = 10;
const ERROR_RATE_THRESHOLD = 0.05;
const ERROR_RATE_MIN_REQUESTS = 20;
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

/** Null unless the window has enough traffic and at least a 5% 5xx rate. */
export function errorRateAlert(requests: number, errors: number): AttentionItem | null {
  if (requests < ERROR_RATE_MIN_REQUESTS || errors / requests < ERROR_RATE_THRESHOLD) return null;
  const pct = ((errors / requests) * 100).toFixed(1).replace(".", ",");
  return {
    id: "error-rate",
    severity: "critical",
    kind: "ERROR_RATE",
    message: `${pct}% request gagal (5xx) dalam 24 jam terakhir, dari ${requests} request`
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}`;

export async function getAttention(now: Date): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const day = new Date(now.getTime() - DAY_MS);
  const idleSince = new Date(now.getTime() - 30 * DAY_MS);
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  const [overdue, pastDue, dueSoon, idle, noRegion, metrics] = await Promise.all([
    withoutTenantScope(async () =>
      db.invoice.findMany({
        where: { status: "OPEN", dueDate: { lt: now } },
        include: { tenant: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: MAX_OVERDUE_LISTED
      })
    ),
    withoutTenantScope(async () => db.tenantSubscription.count({ where: { status: "PAST_DUE" } })),
    withoutTenantScope(async () =>
      db.tenantSubscription.count({ where: { status: "ACTIVE", nextBillingDate: { gte: now, lte: soon } } })
    ),
    db.$queryRaw<{ name: string }[]>(Prisma.sql`
      SELECT t.name FROM "Tenant" t
      WHERE t."isActive" = true AND t."createdAt" < ${idleSince}
        AND NOT EXISTS (
          SELECT 1 FROM "User" u
          WHERE u."tenantId" = t.id AND u."isPlatformAdmin" = false AND u."lastLoginAt" >= ${idleSince}
        )
      ORDER BY t.name LIMIT 50
    `),
    db.tenant.count({ where: { province: null } }),
    db.requestMetricHourly.aggregate({ where: { hour: { gte: day } }, _sum: { count: true, errors5xx: true } })
  ]);

  const rateAlert = errorRateAlert(metrics._sum.count ?? 0, metrics._sum.errors5xx ?? 0);
  if (rateAlert) items.push(rateAlert);

  for (const inv of overdue) {
    const days = Math.max(1, Math.floor((now.getTime() - inv.dueDate.getTime()) / DAY_MS));
    items.push({
      id: `invoice:${inv.id}`,
      severity: "critical",
      kind: "INVOICE_OVERDUE",
      message: `Faktur ${inv.number} (${inv.tenant.name}) lewat jatuh tempo ${days} hari`,
      href: "/platform/invoices"
    });
  }

  if (pastDue > 0) {
    items.push({
      id: "subscriptions-past-due",
      severity: "warning",
      kind: "SUBSCRIPTION_PAST_DUE",
      message: `${plural(pastDue, "langganan")} berstatus menunggak`,
      href: "/platform/tenants"
    });
  }
  if (dueSoon > 0) {
    items.push({
      id: "billing-due-soon",
      severity: "info",
      kind: "BILLING_DUE_SOON",
      message: `${plural(dueSoon, "langganan")} jatuh tempo dalam 7 hari`,
      href: "/platform/invoices"
    });
  }
  if (idle.length > 0) {
    const names = idle.slice(0, 3).map((t) => t.name).join(", ");
    const more = idle.length > 3 ? `, dan ${idle.length - 3} lainnya` : "";
    items.push({
      id: "tenants-inactive",
      severity: "warning",
      kind: "TENANT_INACTIVE",
      message: `${idle.length} koperasi aktif tanpa login 30 hari terakhir: ${names}${more}`,
      href: "/platform/tenants"
    });
  }
  if (noRegion > 0) {
    items.push({
      id: "tenants-no-region",
      severity: "info",
      kind: "TENANT_NO_REGION",
      message: `${noRegion} koperasi belum diisi wilayahnya`,
      href: "/platform/tenants"
    });
  }

  return sortAttention(items);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-attention.test.ts`
Expected: PASS (8 tests). If `db.tenant.count` or `db.requestMetricHourly.aggregate` throws the tenant-scope guard error, those models are guarded after all: wrap that call in `withoutTenantScope(async () => ...)` like the others.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/platform-dashboard/attention.ts apps/backend/tests/platform-dashboard-attention.test.ts
git commit -m "feat(platform): attention items for the platform dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Service, route, wiring

**Files:**
- Create: `apps/backend/src/modules/platform-dashboard/{schema,service,routes}.ts`
- Modify: `apps/backend/src/modules/platform/routes.ts`, `apps/backend/src/app.ts`, `apps/backend/src/main.ts`
- Test: `apps/backend/tests/platform-dashboard-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/platform/dashboard", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/platform/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects a regular tenant admin", async () => {
    const admin = await setupTenant();
    const res = await request(app()).get("/api/platform/dashboard").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("returns every section for a platform admin, defaulting to 30d", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard").set("Authorization", `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.range).toBe("30d");
    expect(d.growth).toHaveLength(30);
    expect(d.performance.activity).toHaveLength(30);
    expect(d.performance.technical).toHaveLength(30);
    expect(d.members.series).toHaveLength(30);
    expect(d.revenue.series).toHaveLength(12);
    expect(d.kpis.tenants).toBe(1);
    expect(d.kpis.users).toBe(1);
    expect(Array.isArray(d.regions)).toBe(true);
    expect(Array.isArray(d.attention)).toBe(true);
    expect(typeof d.kpis.mrr).toBe("string");
  });

  it("switches to monthly buckets for 12m", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard?range=12m").set("Authorization", `Bearer ${session.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.growth).toHaveLength(12);
  });

  it("rejects an unknown range", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard?range=5y").set("Authorization", `Bearer ${session.accessToken}`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform-dashboard-routes.test.ts`
Expected: FAIL (404 on the 200 cases; the 401/403 cases may already pass through the unmatched-route path).

- [ ] **Step 3: Implement schema, service and routes**

`apps/backend/src/modules/platform-dashboard/schema.ts`:

```ts
import { z } from "zod";
import { DASHBOARD_RANGES } from "@siskop/types";

export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("30d")
});
```

`apps/backend/src/modules/platform-dashboard/service.ts`:

```ts
import type { DashboardRange, PlatformDashboard } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { getAttention } from "./attention.js";
import { getGrowth, getMembers } from "./growth.js";
import { getPerformance } from "./performance.js";
import { getRegions } from "./regions.js";
import { getRevenue } from "./revenue.js";

/**
 * Cross-tenant by design: callers are platform admins only (platformRoutes() applies
 * requirePlatformAdmin). Nothing here accepts a tenantId.
 */
export async function getPlatformDashboard(range: DashboardRange, now: Date = new Date()): Promise<PlatformDashboard> {
  const [growth, members, regions, attention, revenue, performance, tenants, users] = await Promise.all([
    getGrowth(range, now),
    getMembers(range, now),
    getRegions(),
    getAttention(now),
    getRevenue(now),
    getPerformance(range, now),
    db.tenant.count(),
    withoutTenantScope(async () => db.user.count({ where: { isPlatformAdmin: false } }))
  ]);

  return {
    range,
    generatedAt: now.toISOString(),
    kpis: { tenants, users, members: members.total, mrr: revenue.mrr },
    performance,
    growth,
    members,
    regions,
    attention,
    revenue
  };
}
```

`apps/backend/src/modules/platform-dashboard/routes.ts`:

```ts
import { Router, type NextFunction, type Request, type Response } from "express";
import { dashboardQuerySchema } from "./schema.js";
import { getPlatformDashboard } from "./service.js";

/** Mounted under platformRoutes(), which already applies requireAuth + requirePlatformAdmin. */
export function platformDashboardRoutes(): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response, next: NextFunction) => {
    const { range } = dashboardQuerySchema.parse(req.query);
    getPlatformDashboard(range)
      .then((data) => res.json({ success: true, data, meta: res.locals.meta }))
      .catch(next);
  });
  return router;
}
```

(`parse` throws synchronously inside the handler; Express 4 forwards synchronous throws to the error handler, which maps `ZodError` to 400 like the other routes. If the test shows a 500, wrap the parse in a `try { } catch (err) { next(err); return; }`.)

- [ ] **Step 4: Wire the route, middleware and flush timer**

In `apps/backend/src/modules/platform/routes.ts` add the import and mount (next to the invoices mount):

```ts
import { platformDashboardRoutes } from "../platform-dashboard/routes.js";
```

```ts
  // Cross-tenant dashboard: growth, regions, revenue, attention, performance.
  router.use("/dashboard", platformDashboardRoutes());
```

In `apps/backend/src/app.ts` add `import { requestMetrics } from "./modules/platform-dashboard/request-metrics.js";` and, directly after the `res.locals.meta` middleware block (the one commented "One requestId per request"):

```ts
  // Latency and 5xx telemetry for the platform dashboard; buffered in memory, flushed by main.ts.
  app.use(requestMetrics());
```

In `apps/backend/src/main.ts`, add `import { startMetricsFlush } from "./modules/platform-dashboard/request-metrics.js";` and call `startMetricsFlush();` just before `createApp().listen(...)`.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform-dashboard-routes.test.ts tests/platform.test.ts tests/health.test.ts`
Expected: PASS. (`platform.test.ts` and `health.test.ts` guard against the new middleware breaking existing routes.)

- [ ] **Step 6: Typecheck and lint the backend**

Run: `pnpm --filter @siskop/backend typecheck && pnpm --filter @siskop/backend lint`
Expected: both exit 0 except for the `PlatformTenantSummary` province/city errors in `platform/service.ts` fixed in Task 11. If those are the only errors, continue.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src apps/backend/tests/platform-dashboard-routes.test.ts
git commit -m "feat(platform): GET /api/platform/dashboard and request telemetry wiring

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Tenant region in the platform API

**Files:**
- Modify: `apps/backend/src/modules/platform/schema.ts`, `apps/backend/src/modules/platform/service.ts`
- Test: `apps/backend/tests/platform.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/tests/platform.test.ts`:

```ts
describe("tenant region", () => {
  it("stores province and city when provisioning a koperasi", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ ...NEW_TENANT, province: "35", city: "Surabaya" });
    expect(res.status).toBe(201);

    const list = await request(app()).get("/api/platform/tenants").set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    const baru = list.body.data.find((t: { slug: string }) => t.slug === "baru");
    expect(baru).toMatchObject({ province: "35", city: "Surabaya" });
  });

  it("rejects an unknown province code", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ ...NEW_TENANT, province: "00" });
    expect(res.status).toBe(400);
  });

  it("lets a platform admin set and clear a region on an existing tenant", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const tenantId = platformAdmin.user.tenantId;

    const set = await request(app())
      .put(`/api/platform/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ province: "32", city: "Bandung" });
    expect(set.status).toBe(200);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).province).toBe("32");

    const cleared = await request(app())
      .put(`/api/platform/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ province: null, city: null });
    expect(cleared.status).toBe(200);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).province).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/platform.test.ts -t "tenant region"`
Expected: FAIL (province missing from the list, `province: "00"` accepted).

- [ ] **Step 3: Extend the Zod schemas**

In `apps/backend/src/modules/platform/schema.ts` change the first import line group to include `PROVINCES`, define the shared schema, and use it:

```ts
import { CooperativeType, PROVINCES } from "@siskop/types";
```

Above `createTenantSchema`:

```ts
const provinceCodeSchema = z
  .string()
  .refine((code) => PROVINCES.some((p) => p.code === code), "Kode provinsi tidak dikenal");
const citySchema = z.string().trim().min(1).max(100);
```

Add to the `createTenantSchema` object (after `address`):

```ts
  province: provinceCodeSchema.optional(),
  city: citySchema.optional(),
```

Add to `updateTenantStatusSchema`:

```ts
  province: provinceCodeSchema.nullable().optional(),
  city: citySchema.nullable().optional()
```

(mind the comma after the `nextBillingDate` line).

- [ ] **Step 4: Persist and expose the fields**

In `apps/backend/src/modules/platform/service.ts`:

- `listTenants()` mapping: add `province: t.province, city: t.city,` to the returned object.
- `createTenant()`: inside the `withManagedIdentity` callback, after `const superAdminRole ...` check and before `tx.user.create`, add:

```ts
      if (data.province || data.city) {
        await tx.tenant.update({ where: { id: tenant.id }, data: { province: data.province ?? null, city: data.city ?? null } });
      }
```

- `updateTenantStatus()`: add to the `data` spread list:

```ts
      ...(data.province !== undefined ? { province: data.province } : {}),
      ...(data.city !== undefined ? { city: data.city } : {})
```

(comma after the `nextBillingDate` spread).

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm exec vitest run tests/platform.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @siskop/backend typecheck && pnpm --filter @siskop/backend lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/platform apps/backend/tests/platform.test.ts
git commit -m "feat(platform): set a koperasi's province and city

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Frontend view helpers

**Files:**
- Create: `apps/frontend/src/pages/platform/dashboard/dashboardView.ts`
- Test: `apps/frontend/src/pages/platform/dashboard/dashboardView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { RegionRow, TechnicalPoint } from "@siskop/types";
import { bucketLabel, deltaLabel, hasTechnicalData, topRegions } from "./dashboardView";

describe("bucketLabel", () => {
  it("formats a day as 'D Mon' and a month as 'Mon YYYY' in Indonesian", () => {
    expect(bucketLabel("2026-10-05")).toBe("5 Okt");
    expect(bucketLabel("2026-05-30")).toBe("30 Mei");
    expect(bucketLabel("2026-08")).toBe("Agu 2026");
  });
});

describe("deltaLabel", () => {
  it("signs the change and uses a decimal comma", () => {
    expect(deltaLabel(12.5)).toBe("+12,5% dari bulan lalu");
    expect(deltaLabel(-3)).toBe("-3,0% dari bulan lalu");
    expect(deltaLabel(0)).toBe("0,0% dari bulan lalu");
  });
  it("says there is nothing to compare when null", () => {
    expect(deltaLabel(null)).toBe("Belum ada pembanding");
  });
});

describe("hasTechnicalData", () => {
  const point = (requests: number): TechnicalPoint => ({ bucket: "2026-10-01", requests, errorRate: 0, p50Ms: null, p95Ms: null });
  it("is true only when some bucket has requests", () => {
    expect(hasTechnicalData([point(0), point(0)])).toBe(false);
    expect(hasTechnicalData([point(0), point(3)])).toBe(true);
  });
});

describe("topRegions", () => {
  const row = (code: string | null, name: string): RegionRow => ({ code, name, tenants: 1, users: 1, members: 1 });
  it("keeps the first N named regions and always appends the unset row", () => {
    const rows = [row("35", "Jawa Timur"), row("32", "Jawa Barat"), row("33", "Jawa Tengah"), row(null, "Belum diisi")];
    expect(topRegions(rows, 2).map((r) => r.name)).toEqual(["Jawa Timur", "Jawa Barat", "Belum diisi"]);
  });
  it("omits the unset row when there is none", () => {
    expect(topRegions([row("35", "Jawa Timur")], 5)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `apps/frontend`): `pnpm exec vitest run src/pages/platform/dashboard/dashboardView.test.ts`
Expected: FAIL, cannot find module `./dashboardView`.

- [ ] **Step 3: Implement**

`apps/frontend/src/pages/platform/dashboard/dashboardView.ts`:

```ts
import type { AttentionSeverity, DashboardRange, RegionRow, TechnicalPoint } from "@siskop/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const RANGE_LABEL: Record<DashboardRange, string> = { "30d": "30 hari", "90d": "90 hari", "12m": "12 bulan" };

export const SEVERITY_LABEL: Record<AttentionSeverity, string> = { critical: "Kritis", warning: "Perlu dicek", info: "Info" };

/** `2026-10-05` -> `5 Okt`; `2026-08` -> `Agu 2026`. */
export function bucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-");
  const name = MONTHS[Number(month) - 1] ?? month ?? "";
  return day ? `${Number(day)} ${name}` : `${name} ${year}`;
}

export function deltaLabel(pct: number | null): string {
  if (pct === null) return "Belum ada pembanding";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}% dari bulan lalu`;
}

export const hasTechnicalData = (points: TechnicalPoint[]): boolean => points.some((p) => p.requests > 0);

/** First `limit` named regions (already sorted by the API), plus the "Belum diisi" row if present. */
export function topRegions(rows: RegionRow[], limit = 10): RegionRow[] {
  const named = rows.filter((r) => r.code !== null).slice(0, limit);
  const unset = rows.find((r) => r.code === null);
  return unset ? [...named, unset] : named;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run src/pages/platform/dashboard/dashboardView.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pages/platform/dashboard/dashboardView.ts apps/frontend/src/pages/platform/dashboard/dashboardView.test.ts
git commit -m "feat(platform-ui): dashboard view helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Dashboard panels and page

**Files:**
- Create: `apps/frontend/src/pages/platform/dashboard/{KpiCards,LinePanel,RevenuePanel,RegionPanel,AttentionPanel}.tsx`, `apps/frontend/src/pages/platform/PlatformDashboardPage.tsx`

The theme exposes `--chart-1` … `--chart-5` as HSL triples; use `hsl(var(--chart-N))`. `formatRupiah(number)` and `formatAngkaRingkas(number)` come from `@/lib/format`.

- [ ] **Step 1: KPI cards**

`KpiCards.tsx`:

```tsx
import type { PlatformDashboard } from "@siskop/types";
import { formatAngkaRingkas, formatRupiah } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCards({ kpis }: { kpis: PlatformDashboard["kpis"] }) {
  const items = [
    { label: "Koperasi", value: kpis.tenants.toLocaleString("id-ID") },
    { label: "Pengguna staf", value: kpis.users.toLocaleString("id-ID") },
    { label: "Anggota", value: kpis.members.toLocaleString("id-ID") },
    { label: "MRR", value: formatRupiah(Number(kpis.mrr)), hint: formatAngkaRingkas(Number(kpis.mrr)) }
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Generic line panel**

`LinePanel.tsx`:

```tsx
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
}

interface LinePanelProps {
  title: string;
  description: string;
  /** Each row needs a `label` for the x axis plus one numeric (or null) field per series key. */
  data: Record<string, string | number | null>[];
  series: LineSeries[];
  /** Shown instead of the chart when true (for example, no telemetry yet). */
  empty?: string | undefined;
  formatValue?: (n: number) => string;
}

function summarize(data: LinePanelProps["data"], series: LineSeries[]): string {
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) return "Belum ada data.";
  return series.map((s) => `${s.name}: dari ${first[s.key] ?? 0} pada ${first.label} menjadi ${last[s.key] ?? 0} pada ${last.label}`).join(". ");
}

export function LinePanel({ title, description, data, series, empty, formatValue = (n) => n.toLocaleString("id-ID") }: LinePanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div role="img" aria-label={`${title}. ${summarize(data, series)}`} className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatValue(v)} allowDecimals={false} />
                <Tooltip formatter={(v: number) => formatValue(v)} />
                {series.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {!empty && series.length > 1 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Revenue panel**

`RevenuePanel.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RevenueSummary } from "@siskop/types";
import { formatAngkaRingkas, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bucketLabel, deltaLabel } from "./dashboardView";

export function RevenuePanel({ revenue }: { revenue: RevenueSummary }) {
  const data = revenue.series.map((p) => ({ label: bucketLabel(p.month), amount: Number(p.amount) }));
  const total = data.reduce((sum, p) => sum + p.amount, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pertumbuhan revenue</CardTitle>
        <p className="text-xs text-muted-foreground">Pembayaran faktur langganan yang lunas, 12 bulan terakhir</p>
        <p className="pt-1 text-lg font-bold tabular-nums">
          {formatRupiah(Number(revenue.thisMonth))}
          <span className="ml-2 text-xs font-semibold text-muted-foreground">{deltaLabel(revenue.deltaPct)}</span>
        </p>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Belum ada pembayaran tercatat.</p>
        ) : (
          <div role="img" aria-label={`Revenue bulan ini ${formatRupiah(Number(revenue.thisMonth))}, ${deltaLabel(revenue.deltaPct)}`} className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v: number) => formatAngkaRingkas(v)} />
                <Tooltip formatter={(v: number) => formatRupiah(v)} />
                <Bar dataKey="amount" name="Revenue" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">MRR saat ini: {formatRupiah(Number(revenue.mrr))}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Region panel**

`RegionPanel.tsx`:

```tsx
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RegionRow } from "@siskop/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { topRegions } from "./dashboardView";

const METRICS = [
  { key: "users", label: "Pengguna" },
  { key: "members", label: "Anggota" },
  { key: "tenants", label: "Koperasi" }
] as const;

export function RegionPanel({ regions }: { regions: RegionRow[] }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("users");
  const rows = topRegions(regions, 10);
  const label = METRICS.find((m) => m.key === metric)?.label ?? "";
  const height = Math.max(220, rows.length * 28 + 32);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sebaran wilayah</CardTitle>
        <p className="text-xs text-muted-foreground">Berdasarkan provinsi koperasi</p>
        <div className="flex gap-1 pt-2" role="group" aria-label="Ukuran sebaran">
          {METRICS.map((m) => (
            <Button key={m.key} size="sm" variant={metric === m.key ? "default" : "outline"} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>
              {m.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Belum ada koperasi.</p>
        ) : (
          <div role="img" aria-label={`Sebaran ${label} per provinsi: ${rows.map((r) => `${r.name} ${r[metric]}`).join(", ")}`} style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number) => v.toLocaleString("id-ID")} />
                <Bar dataKey={metric} name={label} fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Attention panel**

`AttentionPanel.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { AttentionItem } from "@siskop/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEVERITY_LABEL } from "./dashboardView";

const VARIANT = { critical: "destructive", warning: "secondary", info: "outline" } as const;

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Perlu perhatian</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada yang perlu ditindaklanjuti.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <Badge variant={VARIANT[item.severity]} className="mt-0.5 shrink-0">
                  {SEVERITY_LABEL[item.severity]}
                </Badge>
                {item.href ? (
                  <Link to={item.href} className="underline-offset-2 hover:underline">
                    {item.message}
                  </Link>
                ) : (
                  <span>{item.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: The page**

`PlatformDashboardPage.tsx`:

```tsx
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DASHBOARD_RANGES, type DashboardRange, type PlatformDashboard } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionPanel } from "./dashboard/AttentionPanel";
import { KpiCards } from "./dashboard/KpiCards";
import { LinePanel } from "./dashboard/LinePanel";
import { RegionPanel } from "./dashboard/RegionPanel";
import { RevenuePanel } from "./dashboard/RevenuePanel";
import { bucketLabel, hasTechnicalData, RANGE_LABEL } from "./dashboard/dashboardView";

const C = (n: number) => `hsl(var(--chart-${n}))`;

export function PlatformDashboardPage() {
  const role = useAuth((s) => s.user?.role);
  const [range, setRange] = useState<DashboardRange>("30d");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["platform", "dashboard", range],
    queryFn: () => apiFetch<PlatformDashboard>(`/platform/dashboard?range=${range}`)
  });

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const header = (
    <PageHeader
      title="Dashboard platform"
      description="Kondisi SISKOP secara keseluruhan: performa, pertumbuhan, wilayah, dan revenue"
      actions={
        <div className="flex gap-1" role="group" aria-label="Rentang waktu">
          {DASHBOARD_RANGES.map((r) => (
            <Button key={r} size="sm" variant={range === r ? "default" : "outline"} aria-pressed={range === r} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </Button>
          ))}
        </div>
      }
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <FormError error={error instanceof Error ? error.message : "Gagal memuat dashboard"} />
        <Button variant="outline" onClick={() => void refetch()}>Coba lagi</Button>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[300px]" />)}
        </div>
      </div>
    );
  }

  const label = <T extends { bucket: string }>(rows: T[]) => rows.map((r) => ({ ...r, label: bucketLabel(r.bucket) }));
  const technical = label(data.performance.technical).map((p) => ({
    ...p,
    errorPct: Math.round(p.errorRate * 1000) / 10
  }));

  return (
    <div className="space-y-6">
      {header}
      <KpiCards kpis={data.kpis} />

      <div className="grid gap-4 lg:grid-cols-2">
        <LinePanel
          title="Performa: aktivitas"
          description={`Aksi tercatat per ${range === "12m" ? "bulan" : "hari"}. Koperasi aktif: ${data.performance.activeTenants7d} (7 hari), ${data.performance.activeTenants30d} (30 hari)`}
          data={label(data.performance.activity)}
          series={[{ key: "actions", name: "Aksi tercatat", color: C(1) }]}
        />
        <LinePanel
          title="Performa: latensi"
          description="p50 dan p95 dalam milidetik (perkiraan, rata-rata berbobot dari data per jam)"
          data={technical}
          series={[
            { key: "p50Ms", name: "p50", color: C(4) },
            { key: "p95Ms", name: "p95", color: C(2), dashed: true }
          ]}
          empty={hasTechnicalData(data.performance.technical) ? undefined : "Telemetri baru mulai terkumpul sejak fitur ini dirilis."}
          formatValue={(n) => `${n} ms`}
        />
        <LinePanel
          title="Pertumbuhan koperasi dan pengguna"
          description="Koperasi baru dan pengguna staf baru"
          data={label(data.growth)}
          series={[
            { key: "tenants", name: "Koperasi baru", color: C(3) },
            { key: "users", name: "Pengguna baru", color: C(2), dashed: true }
          ]}
        />
        <LinePanel
          title="Pertumbuhan anggota"
          description={`Total anggota di seluruh koperasi: ${data.members.total.toLocaleString("id-ID")}`}
          data={label(data.members.series)}
          series={[{ key: "totalMembers", name: "Total anggota", color: C(4) }]}
        />
        <RegionPanel regions={data.regions} />
        <RevenuePanel revenue={data.revenue} />
      </div>

      <AttentionPanel items={data.attention} />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and lint**

Run (from repo root): `pnpm --filter @siskop/frontend typecheck && pnpm --filter @siskop/frontend lint`
Expected: exit 0 except for any errors from `PlatformTenantSummary` fields that Task 14 resolves. Fix every error in the files created in this task before continuing (for example, `PageHeader` `actions` prop typing, `Skeleton` import path, or `exactOptionalPropertyTypes` complaints on `empty`).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/pages/platform
git commit -m "feat(platform-ui): platform dashboard page and panels

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Route, navigation, landing page

**Files:**
- Modify: `apps/frontend/src/App.tsx`, `apps/frontend/src/components/layout/nav.ts`, `apps/frontend/src/components/layout/nav.test.ts`, `apps/frontend/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Update the nav test first**

In `nav.test.ts`, in the test "gives a platform admin only the platform group", prepend `"/platform/dashboard",` to the expected `href` array:

```ts
    expect(sections[0]?.items.map((i) => i.href)).toEqual([
      "/platform/dashboard",
      "/platform/tenants",
      "/platform/packages",
      "/platform/pricing",
      "/platform/invoices",
      "/platform/admins"
    ]);
```

Run (from `apps/frontend`): `pnpm exec vitest run src/components/layout/nav.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add the nav entry**

In `nav.ts`, make `PLATFORM_NAV` start with (the `Gauge` icon is already imported there):

```ts
  { id: "p-dashboard", label: "Dashboard", href: "/platform/dashboard", icon: Gauge, group: "platform" },
```

- [ ] **Step 3: Add the route and the landing redirect**

In `App.tsx`, next to the other platform lazy imports:

```tsx
const PlatformDashboardPage = lazy(() =>
  import("@/pages/platform/PlatformDashboardPage").then((module) => ({ default: module.PlatformDashboardPage }))
);
```

and as the first platform route (above `/platform/tenants`):

```tsx
              <Route path='/platform/dashboard' element={<PlatformDashboardPage />} />
```

In `AppLayout.tsx` line 84, change `<Navigate to="/platform/tenants" replace />` to `<Navigate to="/platform/dashboard" replace />`.

- [ ] **Step 4: Run frontend tests, typecheck, lint**

Run (from `apps/frontend`): `pnpm exec vitest run src/components/layout src/pages/platform`
Expected: PASS.
Run (from root): `pnpm --filter @siskop/frontend typecheck && pnpm --filter @siskop/frontend lint`
Expected: exit 0 except `PlatformTenantsPage` errors (if any) handled in Task 15.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/components/layout
git commit -m "feat(platform-ui): route, nav entry and landing page for the dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Province and city in the tenant forms

**Files:**
- Modify: `apps/frontend/src/pages/platform/PlatformTenantsPage.tsx`

- [ ] **Step 1: Import the list and extend the create form**

Add `PROVINCES` to the `@siskop/types` value import (it is currently a type-only import: split it, keeping `import type { ... }` for the types and adding `import { PROVINCES } from "@siskop/types";`).

Extend the Zod `schema` with:

```ts
  province: z.string().optional(),
  city: z.string().optional(),
```

and `DEFAULTS` with `province: "", city: "",`.

In `onSubmit`'s `apiPost("/platform/tenants", {...})` payload add:

```ts
        ...(v.province ? { province: v.province } : {}),
        ...(v.city?.trim() ? { city: v.city.trim() } : {}),
```

In the create form JSX, directly after the address `Textarea` block (the `errors.address` paragraph's closing `</div>`), add:

```tsx
              <div className="grid gap-4 sm:grid-cols-2 sm:col-span-2">
                <div className="space-y-1.5">
                  <Label>Provinsi</Label>
                  <Select value={values.province || "none"} onValueChange={(v) => setValue("province", v === "none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Belum diisi</SelectItem>
                      {PROVINCES.map((p) => (
                        <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Kota/Kabupaten</Label>
                  <Input placeholder="Surabaya" {...register("city")} />
                </div>
              </div>
```

(The shadcn `Select` + react-hook-form pairing needs `setValue` + `watch`, which this page already uses for `type`/`firstUnitType`. If the surrounding container is not a grid, drop `sm:col-span-2` and keep the inner `grid`.)

- [ ] **Step 2: Extend the "Kelola" dialog**

Add state next to the other `manage*` state:

```tsx
  const [manageProvince, setManageProvince] = useState("");
  const [manageCity, setManageCity] = useState("");
```

In `openManage` add:

```tsx
    setManageProvince(tenant.province ?? "");
    setManageCity(tenant.city ?? "");
```

In `onManageSubmit`'s `apiPut` payload add:

```tsx
        province: manageProvince || null,
        city: manageCity.trim() || null,
```

In the Kelola dialog form, below the package `Select` block add:

```tsx
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Provinsi</Label>
                <Select value={manageProvince || "none"} onValueChange={(v) => setManageProvince(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Belum diisi</SelectItem>
                    {PROVINCES.map((p) => (
                      <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kota/Kabupaten</Label>
                <Input value={manageCity} onChange={(e) => setManageCity(e.target.value)} placeholder="Surabaya" />
              </div>
            </div>
```

- [ ] **Step 3: Typecheck, lint, test**

Run (from root): `pnpm --filter @siskop/frontend typecheck && pnpm --filter @siskop/frontend lint && pnpm --filter @siskop/frontend test`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/pages/platform/PlatformTenantsPage.tsx
git commit -m "feat(platform-ui): set province and city on koperasi

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Verification

- [ ] **Step 1: Repo-wide static checks**

Run (from root): `pnpm run typecheck && pnpm run lint`
Expected: exit 0 for all packages. Backend `tsc` skips `tests/`, so also run `pnpm --filter @siskop/backend exec tsc --noEmit -p tsconfig.json` only if a test-specific tsconfig exists; otherwise rely on the Vitest runs.

- [ ] **Step 2: All new and touched backend test files**

Run (from `apps/backend`): `pnpm exec vitest run tests/platform-dashboard-buckets.test.ts tests/platform-dashboard-growth.test.ts tests/platform-dashboard-revenue.test.ts tests/platform-dashboard-regions.test.ts tests/platform-dashboard-metrics.test.ts tests/platform-dashboard-performance.test.ts tests/platform-dashboard-attention.test.ts tests/platform-dashboard-routes.test.ts tests/platform.test.ts tests/health.test.ts tests/tenant-scope.test.ts`
Expected: all PASS. (Drop `tests/tenant-scope.test.ts` from the command if that file does not exist.)

- [ ] **Step 3: Full backend suite with the coverage gate**

Run in the background (about 13 minutes): `pnpm --filter @siskop/backend test`
Expected: passes with ≥ 80% line coverage. One known timeout failure on untouched `main` may appear; confirm any failure is unrelated by checking it fails the same way on `main` before reporting it as pre-existing.

- [ ] **Step 4: Look at the page in a real browser**

Use a scratch stack, not the user's servers: backend on port 3101 and Vite on 3100, against a scratch database, following `memory/siskop_v3_scratch_stack_and_migration_ui_2026_10_31.md` (and `/login/legacy` for local browser login). Log in as a platform admin, open `/platform/dashboard`, and confirm: six panels render, the 30d/90d/12m buttons refetch, the latency panel shows the empty message until a few requests have been flushed (`startMetricsFlush` runs every 60 s), the region panel shows "Belum diisi" until a province is set from Koperasi → Kelola, and the layout holds at phone width. Stop only processes you started, via TaskStop.

- [ ] **Step 5: Report**

State plainly what passed, what was not run, and anything seen in the browser that differs from the spec. Then use `superpowers:finishing-a-development-branch`.
