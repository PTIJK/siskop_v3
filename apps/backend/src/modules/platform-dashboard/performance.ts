import { Prisma } from "@prisma/client";
import type { ActivityPoint, DashboardRange, TechnicalPoint } from "@siskop/types";
import { db } from "../../lib/db.js";
import { buildBuckets, granularityOf, jakartaWallClock, type Bucket, type Granularity } from "./buckets.js";
import { countPerBucket, utcParam } from "./counts.js";

const DAY_MS = 86_400_000;

interface MetricRow {
  hour: Date;
  count: number;
  errors5xx: number;
  p50Ms: number;
  p95Ms: number;
}

/** Folds hourly rows into the range's Asia/Jakarta buckets. Percentiles are count-weighted averages, so approximate. */
export function aggregateTechnical(rows: MetricRow[], buckets: Bucket[], granularity: Granularity): TechnicalPoint[] {
  const sliceLength = granularity === "day" ? 10 : 7;
  const acc = new Map<string, { requests: number; errors: number; p50: number; p95: number }>();
  for (const r of rows) {
    const key = jakartaWallClock(r.hour).toISOString().slice(0, sliceLength);
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
    WHERE "isPlatformAdmin" = false AND "lastLoginAt" >= ${utcParam(since)}
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
