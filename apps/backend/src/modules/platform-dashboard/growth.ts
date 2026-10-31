import { Prisma } from "@prisma/client";
import type { DashboardRange, PlatformGrowthPoint, MemberPoint } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { buildBuckets, fill, granularityOf } from "./buckets.js";
import { countPerBucket } from "./counts.js";

const STAFF_ONLY = Prisma.sql`AND "isPlatformAdmin" = false`;

/** New tenants and new staff users (platform admins excluded) per bucket. */
export async function getGrowth(range: DashboardRange, now: Date): Promise<PlatformGrowthPoint[]> {
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
