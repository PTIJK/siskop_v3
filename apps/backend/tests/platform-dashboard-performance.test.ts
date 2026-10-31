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

  it("buckets an hour by its Jakarta calendar day", () => {
    const points = aggregateTechnical(
      [{ hour: new Date("2026-10-30T18:00:00Z"), count: 5, errors5xx: 0, p50Ms: 10, p95Ms: 20 }],
      buckets,
      "day"
    );
    expect(points.find((p) => p.bucket === "2026-10-31")?.requests).toBe(5);
    expect(points.find((p) => p.bucket === "2026-10-30")?.requests).toBe(0);
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
